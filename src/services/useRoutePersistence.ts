import { useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RouteSessionStatus, type RouteSession } from '../models/RouteSession';

const SESSION_KEY = '@brentwood_disposal/route_session';
const DEBOUNCE_MS = 600;

// Bump when the on-disk shape changes in a non-additive way.
// Legacy saves (no schemaVersion field) are accepted by validateSession;
// once a save is re-written, schemaVersion is stamped on.
export const CURRENT_SCHEMA_VERSION = 1;

export interface PersistenceResult {
  /**
   * Debounced write — schedules a disk write DEBOUNCE_MS after the last call.
   */
  save: (
    session: RouteSession,
    log: (tag: string, msg: string) => void
  ) => void;

  /**
   * Immediately flushes any pending debounced write to disk.
   * Call on app background to ensure nothing is lost.
   */
  flush: (log: (tag: string, msg: string) => void) => Promise<void>;

  /**
   * Reads the stored session. Returns null if none exists or on read error.
   */
  restore: (
    log: (tag: string, msg: string) => void
  ) => Promise<RouteSession | null>;

  /**
   * Deletes the stored session.
   */
  reset: (log: (tag: string, msg: string) => void) => Promise<void>;
}

/**
 * Isolated persistence service for route sessions.
 * - Zero UI, zero SDK calls, zero orchestration side-effects.
 * - All disk writes are debounced to avoid excessive I/O on rapid state changes.
 * - The caller supplies a log() function so messages surface in the debug overlay.
 */
export function useRoutePersistence(): PersistenceResult {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSessionRef = useRef<RouteSession | null>(null);

  const save = useCallback(
    (session: RouteSession, log: (tag: string, msg: string) => void) => {
      pendingSessionRef.current = session;
      if (debounceRef.current) clearTimeout(debounceRef.current);

      debounceRef.current = setTimeout(async () => {
        try {
          const json = JSON.stringify({
            ...session,
            updatedAt: Date.now(),
            schemaVersion: CURRENT_SCHEMA_VERSION,
          });
          await AsyncStorage.setItem(SESSION_KEY, json);
          log(
            'PERSIST',
            `SESSION_SAVED — stop ${session.currentStopIndex}/${session.stops.length} status:${session.sessionStatus}`
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log('PERSIST', `SAVE_FAILURE: ${msg}`);
          console.error('[Persistence] save failed:', err);
        }
      }, DEBOUNCE_MS);
    },
    []
  );

  const flush = useCallback(
    async (log: (tag: string, msg: string) => void) => {
      const session = pendingSessionRef.current;
      if (!session) return;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      try {
        const json = JSON.stringify({
          ...session,
          updatedAt: Date.now(),
          schemaVersion: CURRENT_SCHEMA_VERSION,
        });
        await AsyncStorage.setItem(SESSION_KEY, json);
        log(
          'PERSIST',
          `SESSION_FLUSH — stop ${session.currentStopIndex}/${session.stops.length} (app backgrounded)`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log('PERSIST', `FLUSH_FAILURE: ${msg}`);
        console.error('[Persistence] flush failed:', err);
      }
    },
    []
  );

  const restore = useCallback(
    async (log: (tag: string, msg: string) => void): Promise<RouteSession | null> => {
      try {
        const json = await AsyncStorage.getItem(SESSION_KEY);
        if (!json) {
          log('PERSIST', 'No saved session found');
          return null;
        }
        const session = JSON.parse(json) as RouteSession;
        log(
          'PERSIST',
          `SESSION_RESTORED — stop ${session.currentStopIndex}/${session.stops.length} status:${session.sessionStatus}`
        );
        log('PERSIST', `Session ID: ${session.id} created: ${new Date(session.createdAt).toISOString()}`);
        return session;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log('PERSIST', `RESTORE_FAILURE: ${msg}`);
        console.error('[Persistence] restore failed:', err);
        return null;
      }
    },
    []
  );

  const reset = useCallback(
    async (log: (tag: string, msg: string) => void): Promise<void> => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      try {
        await AsyncStorage.removeItem(SESSION_KEY);
        log('PERSIST', 'SESSION_RESET — cleared saved session');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log('PERSIST', `RESET_FAILURE: ${msg}`);
        console.error('[Persistence] reset failed:', err);
      }
    },
    []
  );

  return { save, flush, restore, reset };
}

/** Returns true if a session should be auto-resumed. */
export function isResumableSession(session: RouteSession): boolean {
  return (
    session.sessionStatus !== RouteSessionStatus.COMPLETED &&
    session.currentStopIndex < session.stops.length
  );
}

/**
 * Lightweight existence check used by callers that want to decide whether to
 * render a resume affordance without paying for full JSON parse + validation.
 * Returns true only when a non-empty value sits at SESSION_KEY.
 */
export async function hasSavedSession(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    return !!raw && raw.length > 0;
  } catch {
    return false;
  }
}
