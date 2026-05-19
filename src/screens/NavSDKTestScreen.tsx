/**
 * STAGE D — startGuidance + camera follow + truck-safe routing constraints.
 *
 * Sequence:
 *   Stage A: NavigationView mounts
 *   Stage B: T&C → init() → OK
 *   Stage C: location permission → setDestination(Brentwood, TN, truck routing) → RouteStatus.OK
 *   Stage D: startGuidance() → setFollowingPerspective(TILTED)
 *
 * Hard routing rule: avoidHighways + avoidTolls + avoidFerries enforced on every route.
 * This is not a user toggle — trucks are never allowed on interstates or controlled-access roads.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Platform,
  TouchableOpacity,
} from 'react-native';
import * as Location from 'expo-location';
import {
  NavigationView,
  NavigationSessionStatus,
  RouteStatus,
  CameraPerspective,
  TaskRemovedBehavior,
  useNavigationController,
  type NavigationViewController,
} from '@googlemaps/react-native-navigation-sdk';
import { NavErrorBoundary } from '../components/NavErrorBoundary';

const TERMS_OPTIONS = {
  title: 'Terms of Service',
  companyName: 'Brentwood Disposal',
};

const DESTINATION_BRENTWOOD_TN = {
  position: { lat: 36.0331, lng: -86.7828 },
  title: 'Brentwood, TN',
};

// Hard routing constraints for all trash truck routes — non-negotiable.
// avoidHighways: no interstates, motorways, or controlled-access roads.
// avoidTolls:    no toll roads.
// avoidFerries:  no ferries.
const TRUCK_ROUTING_OPTIONS = {
  avoidHighways: true,
  avoidTolls: true,
  avoidFerries: true,
} as const;

interface LogEntry {
  ts: string;
  tag: string;
  msg: string;
}

function timestamp(): string {
  return new Date().toISOString().split('T')[1]!.slice(0, 12);
}

export function NavSDKTestScreen() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [viewMounted, setViewMounted] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [initStatus, setInitStatus] = useState<string>('PENDING');
  const [permStatus, setPermStatus] = useState<string>('—');
  const [routeStatus, setRouteStatus] = useState<string>('—');
  const [guidanceStatus, setGuidanceStatus] = useState<string>('—');
  const initStartedRef = useRef(false);

  // NavigationViewController is delivered by the view callback — store for camera control
  const navViewControllerRef = useRef<NavigationViewController | null>(null);

  const { navigationController } = useNavigationController(
    TERMS_OPTIONS,
    TaskRemovedBehavior.CONTINUE_SERVICE
  );

  const log = useCallback((tag: string, msg: string) => {
    const entry: LogEntry = { ts: timestamp(), tag, msg };
    console.log(`[${tag}] ${msg}`);
    setLogs((prev) => [entry, ...prev]);
  }, []);

  useEffect(() => {
    log('LIFECYCLE', `mounted — ${Platform.OS}`);
    log('STAGE', 'D — init + permission + destination + startGuidance');
  }, [log]);

  const runSequence = useCallback(async () => {
    // ── Stage B: Terms + Init ─────────────────────────────────────
    try {
      log('INIT', 'Starting init sequence');
      setInitStatus('RUNNING');

      log('TERMS', 'Calling areTermsAccepted()...');
      const alreadyAccepted = await navigationController.areTermsAccepted();
      log('TERMS', `areTermsAccepted → ${alreadyAccepted}`);

      if (!alreadyAccepted) {
        log('TERMS', 'Showing T&C dialog...');
        setInitStatus('WAITING_TERMS');
        const accepted = await navigationController.showTermsAndConditionsDialog();
        log('TERMS', `Dialog → ${accepted ? 'ACCEPTED' : 'DECLINED'}`);
        if (!accepted) {
          log('INIT', 'T&C declined — aborting');
          setInitStatus('TERMS_DECLINED');
          return;
        }
      }

      log('INIT', 'Calling init()...');
      setInitStatus('INITIALIZING');
      const initResult = await navigationController.init();
      log('INIT', `init() → ${initResult}`);

      if (initResult !== NavigationSessionStatus.OK) {
        log('INIT', `Init failed: ${initResult}`);
        setInitStatus(`FAILED:${initResult}`);
        return;
      }

      setInitStatus('OK');
      log('INIT', 'Navigation session ready');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log('INIT_ERR', `Exception: ${msg}`);
      setInitStatus(`ERROR:${msg}`);
      return;
    }

    // ── Stage C-1: Location permission ───────────────────────────
    try {
      log('PERM', 'Checking foreground location permission...');
      const existing = await Location.getForegroundPermissionsAsync();
      log('PERM', `current status: ${existing.status}`);

      if (existing.status !== Location.PermissionStatus.GRANTED) {
        log('PERM', 'Requesting foreground location permission...');
        setPermStatus('REQUESTING');
        const response = await Location.requestForegroundPermissionsAsync();
        log('PERM', `requestForegroundPermissionsAsync → ${response.status}`);
        setPermStatus(response.status);

        if (response.status !== Location.PermissionStatus.GRANTED) {
          log('PERM', `Permission ${response.status} — aborting`);
          setRouteStatus('NO_PERMISSION');
          return;
        }
      } else {
        log('PERM', 'Already granted');
        setPermStatus(existing.status);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log('PERM_ERR', `Exception: ${msg}`);
      setPermStatus(`ERROR:${msg}`);
      return;
    }

    // ── Stage C-2: Set destination (truck-safe routing) ───────────
    try {
      log('DEST', `setDestination → ${DESTINATION_BRENTWOOD_TN.title}`);
      log('DEST', `${DESTINATION_BRENTWOOD_TN.position.lat}, ${DESTINATION_BRENTWOOD_TN.position.lng}`);
      log('ROUTE_OPTS', `avoidHighways=${TRUCK_ROUTING_OPTIONS.avoidHighways} avoidTolls=${TRUCK_ROUTING_OPTIONS.avoidTolls} avoidFerries=${TRUCK_ROUTING_OPTIONS.avoidFerries}`);
      setRouteStatus('CALCULATING');

      const result = await navigationController.setDestination(
        DESTINATION_BRENTWOOD_TN,
        { routingOptions: TRUCK_ROUTING_OPTIONS }
      );

      log('DEST', `setDestination → ${result}`);
      setRouteStatus(result);

      if (result !== RouteStatus.OK) {
        log('DEST', `Route failed: ${result} — aborting`);
        return;
      }

      log('DEST', 'Truck-safe route calculated (no highways/tolls/ferries)');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log('DEST_ERR', `Exception: ${msg}`);
      setRouteStatus(`ERROR:${msg}`);
      return;
    }

    // ── Stage D: Start guidance + camera follow ───────────────────
    try {
      log('GUIDANCE', 'Calling startGuidance()...');
      setGuidanceStatus('STARTING');

      await navigationController.startGuidance();

      log('GUIDANCE', 'startGuidance() succeeded');
      setGuidanceStatus('ACTIVE');

      // Activate tilted camera follow mode
      const navVC = navViewControllerRef.current;
      if (navVC) {
        log('CAMERA', 'Setting TILTED follow perspective...');
        await navVC.setFollowingPerspective(CameraPerspective.TILTED);
        log('CAMERA', 'Camera follow active — Stage D PASSED');
      } else {
        log('CAMERA', 'NavigationViewController not available for camera follow');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log('GUIDANCE_ERR', `Exception: ${msg}`);
      setGuidanceStatus(`ERROR:${msg}`);
    }
  }, [navigationController, log]);

  useEffect(() => {
    if (!mapReady || initStartedRef.current) return;
    initStartedRef.current = true;
    runSequence();
  }, [mapReady, runSequence]);

  function handleNavigationViewControllerCreated(vc: NavigationViewController) {
    navViewControllerRef.current = vc;
    log('NAV_VIEW', 'onNavigationViewControllerCreated — controller stored');
    setViewMounted(true);
  }

  function handleMapViewControllerCreated() {
    log('MAP_VIEW', 'onMapViewControllerCreated fired');
  }

  function handleMapReady() {
    log('MAP_READY', 'onMapReady fired — starting sequence');
    setMapReady(true);
  }

  const handleRecenter = useCallback(async () => {
    const navVC = navViewControllerRef.current;
    if (!navVC) return;
    log('RECENTER', 'Recenter pressed — restoring TILTED follow');
    try {
      await navVC.setFollowingPerspective(CameraPerspective.TILTED);
      log('RECENTER', 'Follow mode restored');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log('RECENTER_ERR', `Exception: ${msg}`);
    }
  }, [log]);

  const initColor = statusColor(initStatus, 'OK');
  const permColor = statusColor(permStatus, Location.PermissionStatus.GRANTED);
  const routeColor = statusColor(routeStatus, RouteStatus.OK);
  const guidanceColor = statusColor(guidanceStatus, 'ACTIVE');

  return (
    <View style={styles.root}>
      <NavErrorBoundary>
        <NavigationView
          style={styles.navView}
          onNavigationViewControllerCreated={handleNavigationViewControllerCreated}
          onMapViewControllerCreated={handleMapViewControllerCreated}
          onMapReady={handleMapReady}
        />
      </NavErrorBoundary>

      {guidanceStatus === 'ACTIVE' && (
        <TouchableOpacity
          style={styles.recenterBtn}
          onPress={handleRecenter}
          activeOpacity={0.75}
        >
          <Text style={styles.recenterIcon}>⊕</Text>
          <Text style={styles.recenterLabel}>Re-center</Text>
        </TouchableOpacity>
      )}

      <View style={styles.overlay} pointerEvents="none">
        <View style={styles.overlayHeader}>
          <Text style={styles.overlayTitle}>NAV SDK — STAGE D</Text>
          <Text style={styles.overlaySubtitle}>
            {viewMounted ? 'VIEW ✓' : 'VIEW…'}
          </Text>
        </View>

        <View style={styles.statusRow}>
          <StatusChip label="INIT" value={initStatus} color={initColor} />
          <StatusChip label="PERM" value={permStatus} color={permColor} />
          <StatusChip label="ROUTE" value={routeStatus} color={routeColor} />
          <StatusChip label="GUIDANCE" value={guidanceStatus} color={guidanceColor} />
        </View>

        <Text style={styles.destLabel}>
          → {DESTINATION_BRENTWOOD_TN.title} · NO HWY · NO TOLL · NO FERRY
        </Text>

        <ScrollView
          style={styles.logScroll}
          contentContainerStyle={styles.logContent}
        >
          {logs.map((entry, i) => (
            <Text key={i} style={styles.logLine}>
              <Text style={styles.logTs}>{entry.ts} </Text>
              <Text style={styles.logTag}>[{entry.tag}] </Text>
              <Text style={styles.logMsg}>{entry.msg}</Text>
            </Text>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

function statusColor(value: string, successValue: string): string {
  if (value === successValue) return '#00ff88';
  if (
    value === '—' ||
    value === 'RUNNING' ||
    value === 'REQUESTING' ||
    value === 'CALCULATING' ||
    value === 'STARTING' ||
    value === 'INITIALIZING' ||
    value === 'WAITING_TERMS'
  )
    return '#aaaaaa';
  return '#ff4444';
}

function StatusChip({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <View style={chipStyles.wrap}>
      <Text style={chipStyles.label}>{label}</Text>
      <Text style={[chipStyles.value, { color }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const chipStyles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
    borderRightWidth: 1,
    borderRightColor: '#00ff8822',
  },
  label: {
    color: '#555',
    fontSize: 8,
    fontFamily: 'monospace',
  },
  value: {
    fontSize: 9,
    fontFamily: 'monospace',
    fontWeight: 'bold',
  },
});

const OVERLAY_H = 270;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  navView: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: OVERLAY_H,
    backgroundColor: 'rgba(0,0,0,0.87)',
    borderTopWidth: 1,
    borderTopColor: '#00ff88',
  },
  overlayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#00ff8833',
  },
  overlayTitle: {
    color: '#00ff88',
    fontSize: 12,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  overlaySubtitle: {
    color: '#aaa',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  statusRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#00ff8822',
  },
  destLabel: {
    color: '#666',
    fontSize: 9,
    fontFamily: 'monospace',
    paddingHorizontal: 12,
    paddingVertical: 3,
    borderBottomWidth: 1,
    borderBottomColor: '#00ff8811',
  },
  logScroll: {
    flex: 1,
  },
  logContent: {
    padding: 8,
    gap: 2,
  },
  logLine: {
    fontSize: 10,
    fontFamily: 'monospace',
    lineHeight: 16,
  },
  logTs: {
    color: '#555',
  },
  logTag: {
    color: '#00aaff',
  },
  logMsg: {
    color: '#ddd',
  },
  recenterBtn: {
    position: 'absolute',
    bottom: OVERLAY_H + 12,
    right: 16,
    backgroundColor: '#fff',
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 6,
  },
  recenterIcon: {
    fontSize: 18,
    color: '#1a73e8',
    lineHeight: 20,
  },
  recenterLabel: {
    fontSize: 10,
    color: '#444',
    fontWeight: '600',
    marginTop: 2,
  },
});
