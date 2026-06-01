import { useEffect, useRef, useState, useCallback } from 'react';
import type { Stop } from '../models/Stop';
import { getOrCreateDriverProfile, syncDriverProfile } from '../services/backend/driverSync';
import { uploadRoute, uploadSessionState } from '../services/backend/routeSync';
import {
  buildTelemetryEvent,
  sendTelemetryEvent,
  flushOfflineQueue,
} from '../services/backend/telemetrySync';
import { isBackendConfigured } from '../services/backend/supabaseClient';
import type { SyncStatus, TelemetryEventType, DriverProfile } from '../services/backend/types';

interface UseBackendSyncResult {
  syncStatus:   SyncStatus;
  driverProfile: DriverProfile | null;
  recordEvent:  (type: TelemetryEventType, payload: Record<string, unknown>) => void;
  syncRoute:    (
    sessionId: string,
    stops: Stop[],
    currentStopIndex: number,
    completedCount: number,
    skippedCount: number,
    sessionStatus: string,
  ) => void;
}

export function useBackendSync(
  isOnline: boolean,
  log: (tag: string, msg: string) => void,
): UseBackendSyncResult {
  const [syncStatus,    setSyncStatus]    = useState<SyncStatus>('idle');
  const [driverProfile, setDriverProfile] = useState<DriverProfile | null>(null);

  const driverProfileRef = useRef<DriverProfile | null>(null);
  const logRef           = useRef(log);
  logRef.current         = log;

  // Init driver profile once on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const profile = await getOrCreateDriverProfile();
        if (cancelled) return;
        driverProfileRef.current = profile;
        setDriverProfile(profile);
        logRef.current('SYNC', `Driver identity loaded — id:${profile.id}`);

        if (isBackendConfigured()) {
          setSyncStatus('syncing');
          await syncDriverProfile(profile, logRef.current);
          setSyncStatus('synced');
        } else {
          logRef.current('SYNC', 'Backend not configured — offline mode');
          setSyncStatus('offline_queue');
        }
      } catch (err) {
        if (!cancelled) {
          logRef.current('SYNC', `Driver init error — ${String(err)}`);
          setSyncStatus('failed');
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Flush offline queue when connectivity is restored
  const prevOnlineRef = useRef(isOnline);
  useEffect(() => {
    const wasOffline = !prevOnlineRef.current && isOnline;
    prevOnlineRef.current = isOnline;
    if (!wasOffline) return;

    logRef.current('SYNC', 'Connection restored — flushing offline queue');
    flushOfflineQueue(logRef.current).catch((err) =>
      logRef.current('SYNC', `Queue flush error — ${String(err)}`),
    );
  }, [isOnline]);

  const recordEvent = useCallback(
    (type: TelemetryEventType, payload: Record<string, unknown>) => {
      const profile = driverProfileRef.current;
      if (!profile) return;

      const sessionId = (payload.sessionId as string | undefined) ?? 'unknown';
      const event = buildTelemetryEvent(type, profile.id, sessionId, payload);

      sendTelemetryEvent(event, logRef.current).catch((err) =>
        logRef.current('TELEMETRY', `recordEvent error — ${String(err)}`),
      );
    },
    [],
  );

  const syncRoute = useCallback(
    (
      sessionId: string,
      stops: Stop[],
      currentStopIndex: number,
      completedCount: number,
      skippedCount: number,
      sessionStatus: string,
    ) => {
      const profile = driverProfileRef.current;
      if (!profile) return;

      setSyncStatus('syncing');

      uploadRoute(
        {
          sessionId,
          driverId:   profile.id,
          totalCount: stops.length,
          createdAt:  Date.now(),
          stops: stops.map((s) => ({
            id:             s.id,
            address:        s.address,
            latitude:       s.latitude,
            longitude:      s.longitude,
            sequenceNumber: s.sequenceNumber,
            status:         s.status,
          })),
        },
        logRef.current,
      )
        .then(() => {
          return uploadSessionState(
            {
              sessionId,
              driverId:         profile.id,
              currentStopIndex,
              completedCount,
              skippedCount,
              sessionStatus,
              updatedAt:        Date.now(),
            },
            logRef.current,
          );
        })
        .then(() => setSyncStatus('synced'))
        .catch((err) => {
          logRef.current('SYNC', `syncRoute error — ${String(err)}`);
          setSyncStatus(isBackendConfigured() ? 'failed' : 'offline_queue');
        });
    },
    [],
  );

  return { syncStatus, driverProfile, recordEvent, syncRoute };
}
