/**
 * NavSDKTestScreen — multi-stop orchestration with arrival detection + session persistence.
 *
 * Layers (each independent):
 *   Navigation layer  → NavigationView, useNavigationController
 *   Orchestration     → useRouteOrchestrator (pure state, no SDK)
 *   Arrival detection → useArrivalDetector (pure GPS, no SDK/orchestration)
 *   Persistence       → useRoutePersistence (AsyncStorage, no SDK/orchestration)
 *   Driver controls   → useDriverControls (safety guards, no SDK/nav/persistence)
 *   Voice feedback    → useVoiceFeedback (expo-speech, isolated)
 *   Haptic feedback   → useHapticFeedback (expo-haptics, isolated)
 *   UI                → WorkflowOverlay + debug log
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { WorkflowOverlay } from '../components/WorkflowOverlay';
import { RouteImportSheet } from '../components/RouteImportSheet';
import { FieldWarningBanner } from '../components/FieldWarningBanner';
import { useAppLifecycle } from '../hooks/useAppLifecycle';
import { useConnectivity } from '../hooks/useConnectivity';
import { useGpsHealth } from '../hooks/useGpsHealth';
import { useRouteOrchestrator } from '../hooks/useRouteOrchestrator';
import { useArrivalDetector, ARRIVAL_THRESHOLD_FEET } from '../hooks/useArrivalDetector';
import { useRoutePersistence, isResumableSession } from '../services/useRoutePersistence';
import { useVoiceFeedback } from '../hooks/useVoiceFeedback';
import { useHapticFeedback } from '../hooks/useHapticFeedback';
import { useDriverControls } from '../hooks/useDriverControls';
import { useCalculationWatchdog } from '../hooks/useCalculationWatchdog';
import { useHealthCheck } from '../hooks/useHealthCheck';
import { calculateRouteMetrics } from '../services/optimization/calculateRouteMetrics';
import { validateSession, castSession } from '../services/sessionValidator';
import { verifyRouteIntegrity } from '../services/routeIntegrity';
import { BRENTWOOD_ROUTE } from '../data/brentwoodRoute';
import { StopStatus, type Stop } from '../models/Stop';
import { RouteSessionStatus } from '../models/RouteSession';

// Hard routing constraints — non-negotiable for trash trucks.
const TRUCK_ROUTING_OPTIONS = {
  avoidHighways: true,
  avoidTolls: true,
  avoidFerries: true,
} as const;

const TERMS_OPTIONS = {
  title: 'Terms of Service',
  companyName: 'Brentwood Disposal',
};

// ── Types ─────────────────────────────────────────────────────────

interface LogEntry {
  ts: string;
  tag: string;
  msg: string;
}

function timestamp(): string {
  return new Date().toISOString().split('T')[1]!.slice(0, 12);
}

function newSessionId(): string {
  return `session-${Date.now()}`;
}

// ── Component ─────────────────────────────────────────────────────

export function NavSDKTestScreen() {
  // ── Navigation SDK ────────────────────────────────────────────
  const { navigationController } = useNavigationController(
    TERMS_OPTIONS,
    TaskRemovedBehavior.CONTINUE_SERVICE
  );
  const navViewControllerRef = useRef<NavigationViewController | null>(null);

  // ── Orchestrator ──────────────────────────────────────────────
  const {
    stops,
    currentStopIndex,
    currentStop,
    nextStop,
    completedCount,
    skippedCount,
    remainingCount,
    isFinished,
    restoreSession,
    markNavigating,
    markArrived,
    markCompleted,
    skipStop,
  } = useRouteOrchestrator(BRENTWOOD_ROUTE);

  // ── Persistence ───────────────────────────────────────────────
  const { save, flush, restore, reset } = useRoutePersistence();

  // ── Driver interaction layer ──────────────────────────────────
  const voice   = useVoiceFeedback();
  const haptic  = useHapticFeedback();
  const { guardedComplete, guardedSkip } = useDriverControls(
    useCallback((tag: string, msg: string) => log(tag, msg), [])  // log ref resolved below
  );

  // ── UI state ──────────────────────────────────────────────────
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [viewMounted, setViewMounted] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [initStatus, setInitStatus] = useState<string>('PENDING');
  const [navReady, setNavReady] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [routeStatus, setRouteStatus] = useState<string>('—');
  const [guidanceActive, setGuidanceActive] = useState(false);
  const [distanceToStop, setDistanceToStop] = useState<number | null>(null);
  const [sessionRestored, setSessionRestored] = useState(false);
  const [showImportSheet, setShowImportSheet] = useState(false);
  const [sessionRecoveringVisible, setSessionRecoveringVisible] = useState(false);
  const [focusMode, setFocusMode] = useState(false);

  // ── Refs ──────────────────────────────────────────────────────
  const initStartedRef      = useRef(false);
  const guidanceStartedRef  = useRef(false);
  const sessionIdRef        = useRef(newSessionId());
  const sessionCreatedAtRef = useRef(Date.now());
  // Battery protection: skip setDestination if we're already routing to this stop
  const lastRoutedStopIdRef = useRef<string | null>(null);

  // Stable refs for voice/haptic — avoid stale closures in callbacks
  const voiceRef  = useRef(voice);
  const hapticRef = useRef(haptic);
  voiceRef.current  = voice;
  hapticRef.current = haptic;

  // ── Logging ───────────────────────────────────────────────────
  const log = useCallback((tag: string, msg: string) => {
    // Suppress high-frequency housekeeping tags in production builds
    if (!__DEV__ && PROD_SUPPRESS.has(tag)) return;
    const entry: LogEntry = { ts: timestamp(), tag, msg };
    if (__DEV__) console.log(`[${tag}] ${msg}`);
    // Cap array to prevent unbounded memory growth over long sessions
    setLogs((prev) => [entry, ...prev.slice(0, MAX_LOGS - 1)]);
  }, []);

  // Stable log ref for useDriverControls (initialized above, updated here)
  const logRef = useRef(log);
  logRef.current = log;

  // ── Field resilience hooks ────────────────────────────────────
  const { connectivity } = useConnectivity(log);
  const { isStale: gpsStale, notifyUpdate: notifyGpsUpdate } = useGpsHealth(8_000, log);

  // ── Derived values ────────────────────────────────────────────
  const estimatedRemainingMinutes = useMemo(() => {
    const remaining = stops.slice(currentStopIndex);
    return remaining.length === 0 ? 0 : calculateRouteMetrics(remaining).estimatedTimeMinutes;
  }, [stops, currentStopIndex]);

  const completedPercent = stops.length > 0
    ? Math.round((completedCount / stops.length) * 100)
    : 0;

  useEffect(() => {
    log('LIFECYCLE', `mounted — ${Platform.OS}`);
    log('CONFIG', `arrival threshold: ${ARRIVAL_THRESHOLD_FEET} ft`);
  }, [log]);

  // ── Voice/haptic: GPS goes stale ─────────────────────────────
  const prevGpsStaleRef = useRef(false);
  useEffect(() => {
    if (gpsStale && !prevGpsStaleRef.current) {
      voiceRef.current.speak('gps_weak');
      hapticRef.current.trigger('error');
    }
    prevGpsStaleRef.current = gpsStale;
  }, [gpsStale]);

  // ── Auto-save on orchestrator state changes ───────────────────
  useEffect(() => {
    if (!navReady) return;
    save(
      {
        id: sessionIdRef.current,
        sessionStatus: isFinished
          ? RouteSessionStatus.COMPLETED
          : RouteSessionStatus.ACTIVE,
        stops,
        currentStopIndex,
        createdAt: sessionCreatedAtRef.current,
        updatedAt: Date.now(),
        completedAt: isFinished ? Date.now() : undefined,
      },
      log
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, currentStopIndex, isFinished, navReady]);

  // ── App lifecycle ─────────────────────────────────────────────
  const handleBackground = useCallback(async () => {
    log('LIFECYCLE', 'APP_BACKGROUND — flushing session to disk');
    await flush(log);
  }, [flush, log]);

  const handleForeground = useCallback(() => {
    log('LIFECYCLE', 'APP_FOREGROUND');
    if (navReady) log('LIFECYCLE', 'SESSION_RECOVERED — route session intact');
  }, [log, navReady]);

  const handleInactive = useCallback(() => {
    log('LIFECYCLE', 'APP_INACTIVE');
  }, [log]);

  useAppLifecycle({
    onBackground: handleBackground,
    onForeground: handleForeground,
    onInactive: handleInactive,
  });

  // Session-recovered banner (5s)
  useEffect(() => {
    if (!sessionRestored) return;
    setSessionRecoveringVisible(true);
    const t = setTimeout(() => setSessionRecoveringVisible(false), 5_000);
    return () => clearTimeout(t);
  }, [sessionRestored]);

  // 30-second checkpoint
  useEffect(() => {
    if (!navReady || isFinished) return;
    const timer = setInterval(() => {
      save(
        {
          id: sessionIdRef.current,
          sessionStatus: RouteSessionStatus.ACTIVE,
          stops,
          currentStopIndex,
          createdAt: sessionCreatedAtRef.current,
          updatedAt: Date.now(),
        },
        log
      );
    }, 30_000);
    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navReady, isFinished, currentStopIndex, stops.length]);

  // ── Arrival detector ──────────────────────────────────────────
  const handleArrived = useCallback(
    (stop: Stop, distFeet: number) => {
      log('ARRIVED', `Stop #${stop.sequenceNumber} — ${Math.round(distFeet)} ft from stop`);
      log('ARRIVED', `${stop.address}`);
      log('ARRIVED', `GPS: ${stop.latitude}, ${stop.longitude} | ${new Date().toISOString()}`);
      voiceRef.current.speak('arrived');
      hapticRef.current.trigger('arrival');
      markArrived();
    },
    [markArrived, log]
  );

  const handleDistanceUpdate = useCallback((distFeet: number) => {
    setDistanceToStop(Math.round(distFeet));
  }, []);

  useArrivalDetector({
    currentStop,
    permissionGranted,
    thresholdFeet: ARRIVAL_THRESHOLD_FEET,
    onArrived: handleArrived,
    onDistanceUpdate: handleDistanceUpdate,
    onPositionReceived: notifyGpsUpdate,
  });

  // ── Phase 1: Init + Permission + optional Restore (once) ──────
  const initAndPermission = useCallback(async () => {
    try {
      log('INIT', 'Starting init sequence');
      setInitStatus('RUNNING');

      log('PERSIST', 'Checking for saved session...');
      const rawSaved = await restore(log);
      if (rawSaved) {
        const validation = validateSession(rawSaved);
        if (!validation.valid) {
          log('PERSIST', `SESSION_CORRUPTED — ${validation.reason}`);
          log('PERSIST', 'Discarding corrupted session — starting fresh');
          await reset(log);
        } else {
          const saved = castSession(rawSaved);

          // Secondary integrity check on stops themselves
          const integrity = verifyRouteIntegrity(saved.stops);
          if (!integrity.ok) {
            log('PERSIST', `SESSION_INTEGRITY_FAIL — ${integrity.reason}`);
            log('PERSIST', 'Discarding session with bad stops — starting fresh');
            await reset(log);
          } else if (isResumableSession(saved)) {
            log('PERSIST', `Resuming session — stop ${saved.currentStopIndex + 1}/${saved.stops.length}`);
            sessionIdRef.current = saved.id;
            sessionCreatedAtRef.current = saved.createdAt;
            restoreSession(saved.stops, saved.currentStopIndex);
            setSessionRestored(true);
          } else {
            log('PERSIST', `Saved session is completed — starting fresh`);
          }
        }
      }

      log('TERMS', 'Checking T&C acceptance...');
      const alreadyAccepted = await navigationController.areTermsAccepted();
      log('TERMS', `areTermsAccepted → ${alreadyAccepted}`);

      if (!alreadyAccepted) {
        setInitStatus('WAITING_TERMS');
        const accepted = await navigationController.showTermsAndConditionsDialog();
        log('TERMS', `Dialog → ${accepted ? 'ACCEPTED' : 'DECLINED'}`);
        if (!accepted) {
          setInitStatus('TERMS_DECLINED');
          return;
        }
      }

      log('INIT', 'Calling init()...');
      setInitStatus('INITIALIZING');
      const initResult = await navigationController.init();
      log('INIT', `init() → ${initResult}`);

      if (initResult !== NavigationSessionStatus.OK) {
        setInitStatus(`FAILED:${initResult}`);
        return;
      }
      setInitStatus('OK');

      log('PERM', 'Checking location permission...');
      const existing = await Location.getForegroundPermissionsAsync();
      log('PERM', `current: ${existing.status}`);

      if (existing.status !== Location.PermissionStatus.GRANTED) {
        log('PERM', 'Requesting foreground permission...');
        const response = await Location.requestForegroundPermissionsAsync();
        log('PERM', `result → ${response.status}`);
        if (response.status !== Location.PermissionStatus.GRANTED) {
          setInitStatus('PERM_DENIED');
          return;
        }
      } else {
        log('PERM', 'Already granted');
      }

      setPermissionGranted(true);
      setNavReady(true);
      log('INIT', sessionRestored ? 'Nav ready — resuming route' : 'Nav ready — starting route');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log('INIT_ERR', `Exception: ${msg}`);
      setInitStatus(`ERROR:${msg}`);
    }
  }, [navigationController, restore, restoreSession, sessionRestored, log]);

  useEffect(() => {
    if (!mapReady || initStartedRef.current) return;
    initStartedRef.current = true;
    initAndPermission();
  }, [mapReady, initAndPermission]);

  // ── Phase 2: Reroute on stop change ──────────────────────────
  const rerouteTo = useCallback(
    async (stop: Stop) => {
      // ── Battery guard: skip if already routing to this exact stop ──
      if (stop.id === lastRoutedStopIdRef.current) {
        log('ROUTE', `REROUTE_GUARD — already routing to stop #${stop.sequenceNumber}, skipped`);
        return;
      }

      // ── Field guard: verify nav controller is alive ──
      if (!navigationController) {
        log('ROUTE_ERR', 'NAV_CONTROLLER_NULL — cannot route');
        return;
      }

      try {
        const isReroute = guidanceStartedRef.current;
        if (isReroute) {
          voiceRef.current.speak('next_stop');
          hapticRef.current.trigger('reroute');
        }

        log('STOP', `▶ Stop #${stop.sequenceNumber}: ${stop.address}`);
        log('ROUTE_OPTS', `avoidHighways=true avoidTolls=true avoidFerries=true`);
        setRouteStatus('CALCULATING');
        setDistanceToStop(null);
        lastRoutedStopIdRef.current = stop.id;

        // Race setDestination against a timeout to detect hung SDK calls
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('ROUTE_CALC_TIMEOUT')), ROUTE_CALC_TIMEOUT)
        );
        const result = await Promise.race([
          navigationController.setDestination(
            { position: { lat: stop.latitude, lng: stop.longitude }, title: stop.address },
            { routingOptions: TRUCK_ROUTING_OPTIONS }
          ),
          timeoutPromise,
        ]);

        log('DEST', `setDestination → ${result}`);
        setRouteStatus(result);

        if (result !== RouteStatus.OK) {
          log('DEST', `Route failed: ${result}`);
          hapticRef.current.trigger('error');
          lastRoutedStopIdRef.current = null; // allow retry
          return;
        }

        log('DEST', 'Truck-safe route calculated');
        markNavigating();

        if (!guidanceStartedRef.current) {
          log('GUIDANCE', 'Starting guidance...');
          await navigationController.startGuidance();
          guidanceStartedRef.current = true;
          setGuidanceActive(true);
          log('GUIDANCE', 'Guidance active');
          const navVC = navViewControllerRef.current;
          if (navVC) {
            await navVC.setFollowingPerspective(CameraPerspective.TILTED);
            log('CAMERA', 'TILTED follow active');
          }
        } else {
          log('GUIDANCE', `Re-routed to stop #${stop.sequenceNumber} — guidance continues`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'ROUTE_CALC_TIMEOUT') {
          log('ROUTE_ERR', `ROUTE_CALC_TIMEOUT — setDestination hung for ${ROUTE_CALC_TIMEOUT / 1000}s`);
          setRouteStatus('TIMEOUT');
        } else {
          log('ROUTE_ERR', `Exception: ${msg}`);
          setRouteStatus(`ERROR:${msg}`);
        }
        hapticRef.current.trigger('error');
        lastRoutedStopIdRef.current = null; // allow retry after error
      }
    },
    [navigationController, markNavigating, log]
  );

  const currentStopId = currentStop?.id;
  useEffect(() => {
    if (!navReady || !currentStop) return;
    rerouteTo(currentStop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navReady, currentStopId]);

  // ── Stuck calculation watchdog ────────────────────────────────
  const isCalculating = routeStatus === 'CALCULATING';
  useCalculationWatchdog(isCalculating, STUCK_CALC_MS, log, () => {
    log('WATCHDOG', 'Clearing stuck CALCULATING status — allow retry');
    setRouteStatus('TIMEOUT');
    hapticRef.current.trigger('error');
    lastRoutedStopIdRef.current = null; // allow re-attempt
  });

  // ── Periodic health checkpoint ────────────────────────────────
  useHealthCheck(HEALTH_INTERVAL, () => {
    const navCtrlAlive = navViewControllerRef.current !== null;
    const indexOk = currentStopIndex <= stops.length;
    log(
      'HEALTH',
      `CHECKPOINT — stops:${stops.length} idx:${currentStopIndex}` +
        ` finished:${isFinished} guidance:${guidanceActive}` +
        ` navCtrl:${navCtrlAlive ? 'alive' : 'STALE'}` +
        ` indexOk:${indexOk}`
    );
    if (guidanceActive && !navCtrlAlive) {
      log('HEALTH', 'STALE_NAV_CONTROLLER — guidance active but view controller is null');
    }
    if (!indexOk) {
      log('HEALTH', `INDEX_OVERFLOW — currentStopIndex ${currentStopIndex} > stops ${stops.length}`);
    }
  });

  // ── Stop actions (guarded) ────────────────────────────────────
  const handleComplete = useCallback(() => {
    guardedComplete(() => {
      if (!currentStop) return;
      const label = currentStop.status === StopStatus.ARRIVED ? 'ARRIVED→COMPLETED' : 'COMPLETED';
      log('STOP', `✓ [${label}] Stop #${currentStop.sequenceNumber}: ${currentStop.address}`);
      log('STOP', `Timestamp: ${new Date().toISOString()}`);
      hapticRef.current.trigger('completion');
      markCompleted();
    });
  }, [guardedComplete, currentStop, markCompleted, log]);

  const handleSkip = useCallback(() => {
    guardedSkip(() => {
      if (!currentStop) return;
      log('STOP', `⤳ [SKIPPED] Stop #${currentStop.sequenceNumber}: ${currentStop.address}`);
      skipStop();
    });
  }, [guardedSkip, currentStop, skipStop, log]);

  // ── Reset route ───────────────────────────────────────────────
  const handleReset = useCallback(async () => {
    log('PERSIST', 'Reset requested — clearing session...');
    await reset(log);
    restoreSession(
      BRENTWOOD_ROUTE.map((s) => ({ ...s, status: StopStatus.PENDING })),
      0
    );
    sessionIdRef.current = newSessionId();
    sessionCreatedAtRef.current = Date.now();
    lastRoutedStopIdRef.current = null;
    setSessionRestored(false);
    setRouteStatus('—');
    setDistanceToStop(null);
    log('PERSIST', 'Route reset to stop #1');
  }, [reset, restoreSession, log]);

  // ── Load imported route ───────────────────────────────────────
  const handleLoadImportedRoute = useCallback(
    async (newStops: Stop[]) => {
      log('IMPORT', `Loading ${newStops.length}-stop route into navigator...`);
      await reset(log);
      restoreSession(newStops, 0);
      sessionIdRef.current = newSessionId();
      sessionCreatedAtRef.current = Date.now();
      lastRoutedStopIdRef.current = null;
      setSessionRestored(false);
      setRouteStatus('—');
      setDistanceToStop(null);
      setShowImportSheet(false);
    },
    [reset, restoreSession, log]
  );

  // ── Recenter ──────────────────────────────────────────────────
  const handleRecenter = useCallback(async () => {
    const navVC = navViewControllerRef.current;
    if (!navVC) return;
    log('RECENTER', 'Restoring TILTED follow');
    try {
      await navVC.setFollowingPerspective(CameraPerspective.TILTED);
      log('RECENTER', 'Follow mode restored');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log('RECENTER_ERR', `Exception: ${msg}`);
    }
  }, [log]);

  // ── NavigationView callbacks ──────────────────────────────────
  function handleNavigationViewControllerCreated(vc: NavigationViewController) {
    navViewControllerRef.current = vc;
    log('NAV_VIEW', 'Controller stored');
    setViewMounted(true);
  }

  function handleMapViewControllerCreated() {
    log('MAP_VIEW', 'onMapViewControllerCreated');
  }

  function handleMapReady() {
    log('MAP_READY', 'Map ready — starting init');
    setMapReady(true);
  }

  // ── Layout constants ──────────────────────────────────────────
  const debugH    = focusMode ? 0 : DEBUG_H;
  const recenterBottom = debugH + WORKFLOW_H + 12;

  // ── Colors ────────────────────────────────────────────────────
  const initColor  = chipColor(initStatus, 'OK');
  const routeColor = chipColor(routeStatus, RouteStatus.OK);
  const navColor   = guidanceActive ? '#00ff88' : '#aaaaaa';

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

      {/* Recenter button */}
      {guidanceActive && (
        <TouchableOpacity
          style={[styles.recenterBtn, { bottom: recenterBottom }]}
          onPress={handleRecenter}
          activeOpacity={0.75}
        >
          <Text style={styles.recenterIcon}>⊕</Text>
          <Text style={styles.recenterLabel}>Re-center</Text>
        </TouchableOpacity>
      )}

      {/* Debug overlay — hidden in focus mode */}
      {!focusMode && (
        <View
          style={[styles.debugOverlay, { bottom: WORKFLOW_H, height: DEBUG_H }]}
          pointerEvents="box-none"
        >
          <View style={styles.debugHeader} pointerEvents="box-none">
            <Text style={styles.debugTitle}>
              {viewMounted ? 'VIEW ✓' : 'VIEW…'}
              {sessionRestored ? '  [RESUMED]' : ''}
            </Text>
            <View style={styles.debugHeaderRight} pointerEvents="box-none">
              <View style={styles.chipRow} pointerEvents="none">
                <MiniChip label="INIT"  value={initStatus}                    color={initColor} />
                <MiniChip label="ROUTE" value={routeStatus}                   color={routeColor} />
                <MiniChip label="NAV"   value={guidanceActive ? 'ACTIVE' : '—'} color={navColor} />
              </View>
              {/* Voice toggle */}
              <TouchableOpacity
                style={[styles.toggleBtn, voice.enabled && styles.toggleBtnOn]}
                onPress={() => voice.setEnabled(!voice.enabled)}
                activeOpacity={0.7}
              >
                <Text style={[styles.toggleBtnText, voice.enabled && styles.toggleBtnTextOn]}>
                  {voice.enabled ? '🔊' : '🔇'}
                </Text>
              </TouchableOpacity>
              {/* Haptic toggle */}
              <TouchableOpacity
                style={[styles.toggleBtn, haptic.enabled && styles.toggleBtnOn]}
                onPress={() => haptic.setEnabled(!haptic.enabled)}
                activeOpacity={0.7}
              >
                <Text style={[styles.toggleBtnText, haptic.enabled && styles.toggleBtnTextOn]}>
                  {haptic.enabled ? '📳' : '📴'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.importBtn}
                onPress={() => setShowImportSheet(true)}
                activeOpacity={0.7}
              >
                <Text style={styles.importBtnText}>IMPORT</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.resetBtn}
                onPress={handleReset}
                activeOpacity={0.7}
              >
                <Text style={styles.resetBtnText}>RESET</Text>
              </TouchableOpacity>
            </View>
          </View>
          <FieldWarningBanner
            gpsStale={gpsStale}
            connectivity={connectivity}
            sessionRecovering={sessionRecoveringVisible}
          />
          <ScrollView
            style={styles.logScroll}
            contentContainerStyle={styles.logContent}
            pointerEvents="none"
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
      )}

      {/* Route import sheet */}
      <RouteImportSheet
        visible={showImportSheet}
        onClose={() => setShowImportSheet(false)}
        onLoadRoute={handleLoadImportedRoute}
        log={log}
      />

      {/* Workflow overlay — driver controls */}
      <View style={[styles.workflowContainer, { height: WORKFLOW_H }]}>
        <WorkflowOverlay
          currentStop={currentStop}
          nextStop={nextStop}
          completedCount={completedCount}
          skippedCount={skippedCount}
          remainingCount={remainingCount}
          totalCount={stops.length}
          isFinished={isFinished}
          routeStatus={routeStatus}
          guidanceActive={guidanceActive}
          distanceToStop={distanceToStop}
          estimatedRemainingMinutes={estimatedRemainingMinutes}
          completedPercent={completedPercent}
          focusMode={focusMode}
          onToggleFocusMode={() => setFocusMode((f) => !f)}
          onComplete={handleComplete}
          onSkip={handleSkip}
          bottomInset={BOTTOM_SAFE}
        />
      </View>
    </View>
  );
}

// ── Helpers ───────────────────────────────────────────────────────

function chipColor(value: string, successValue: string): string {
  if (value === successValue) return '#00ff88';
  if (
    ['—', 'RUNNING', 'REQUESTING', 'CALCULATING', 'INITIALIZING', 'WAITING_TERMS'].includes(value)
  )
    return '#aaaaaa';
  return '#ff4444';
}

function MiniChip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={chipStyles.wrap}>
      <Text style={chipStyles.label}>{label}:</Text>
      <Text style={[chipStyles.value, { color }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

// ── Constants ─────────────────────────────────────────────────────

const BOTTOM_SAFE        = Platform.OS === 'ios' ? 34 : 0;
const WORKFLOW_H         = 220 + BOTTOM_SAFE;
const DEBUG_H            = 150;
const MAX_LOGS           = 500;
const ROUTE_CALC_TIMEOUT = 45_000; // ms before we consider a setDestination hung
const HEALTH_INTERVAL    = 5 * 60_000; // 5-minute health checkpoints
const STUCK_CALC_MS      = 35_000; // ms of CALCULATING before watchdog fires

// Tags that are suppressed in production builds (always visible in DEV)
const PROD_SUPPRESS = new Set(['HEALTH', 'CONFIG']);

// ── Styles ────────────────────────────────────────────────────────

const chipStyles = StyleSheet.create({
  wrap:  { flexDirection: 'row', gap: 2, alignItems: 'center', marginHorizontal: 2 },
  label: { color: '#555', fontSize: 9, fontFamily: 'monospace' },
  value: { fontSize: 9, fontFamily: 'monospace', fontWeight: 'bold' },
});

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#000' },
  navView: { flex: 1 },

  recenterBtn: {
    position: 'absolute',
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
  recenterIcon:  { fontSize: 18, color: '#1a73e8', lineHeight: 20 },
  recenterLabel: { fontSize: 10, color: '#444', fontWeight: '600', marginTop: 2 },

  debugOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.88)',
    borderTopWidth: 1,
    borderTopColor: '#00ff8855',
  },
  debugHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#00ff8820',
  },
  debugTitle: {
    color: '#00ff88',
    fontSize: 9,
    fontFamily: 'monospace',
    fontWeight: 'bold',
  },
  debugHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipRow: { flexDirection: 'row' },

  toggleBtn: {
    backgroundColor: '#1a1a1a',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#333',
  },
  toggleBtnOn: { backgroundColor: '#0d1f3c', borderColor: '#1a73e8' },
  toggleBtnText:    { fontSize: 10 },
  toggleBtnTextOn:  { fontSize: 10 },

  importBtn: {
    backgroundColor: '#0d2040',
    borderRadius: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#1a73e8',
  },
  importBtnText: { color: '#4da6ff', fontSize: 9, fontWeight: 'bold', fontFamily: 'monospace' },
  resetBtn: {
    backgroundColor: '#3a1010',
    borderRadius: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#882222',
  },
  resetBtnText: { color: '#ff6666', fontSize: 9, fontWeight: 'bold', fontFamily: 'monospace' },

  logScroll:  { flex: 1 },
  logContent: { padding: 6, gap: 1 },
  logLine:    { fontSize: 9, fontFamily: 'monospace', lineHeight: 14 },
  logTs:  { color: '#444' },
  logTag: { color: '#0099ee' },
  logMsg: { color: '#ccc' },

  workflowContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
});
