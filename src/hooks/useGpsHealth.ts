import { useState, useEffect, useRef, useCallback } from 'react';

const CHECK_INTERVAL_MS = 3_000;

export interface GpsHealthResult {
  isStale: boolean;
  notifyUpdate: (timestamp: number) => void;
}

/**
 * Detects GPS staleness by tracking how long ago the last position update arrived.
 * notifyUpdate() is called by the arrival detector on every location event.
 * State updates only fire when staleness changes — no per-tick re-renders.
 */
export function useGpsHealth(
  staleThresholdMs: number,
  log: (tag: string, msg: string) => void
): GpsHealthResult {
  const [isStale, setIsStale] = useState(false);
  const lastUpdateAtRef = useRef<number | null>(null);
  const wasStaleRef = useRef(false);
  const logRef = useRef(log);
  logRef.current = log;

  const notifyUpdate = useCallback((timestamp: number) => {
    lastUpdateAtRef.current = timestamp;
    if (wasStaleRef.current) {
      wasStaleRef.current = false;
      setIsStale(false);
      logRef.current('GPS', 'GPS_RECOVERED — position updates resumed');
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      const last = lastUpdateAtRef.current;
      if (last === null) return;
      const ageMs = Date.now() - last;
      if (ageMs > staleThresholdMs && !wasStaleRef.current) {
        wasStaleRef.current = true;
        setIsStale(true);
        logRef.current('GPS', `GPS_STALE — no update for ${Math.round(ageMs / 1000)}s`);
      }
    }, CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [staleThresholdMs]);

  return { isStale, notifyUpdate };
}
