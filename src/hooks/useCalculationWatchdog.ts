import { useEffect, useRef } from 'react';

const CHECK_INTERVAL_MS = 5_000;

/**
 * Detects a stuck route calculation by monitoring how long isCalculating has been true.
 * Calls onStuck once per stuck episode, then resets.
 * - Zero SDK, zero UI, zero persistence.
 */
export function useCalculationWatchdog(
  isCalculating: boolean,
  stuckThresholdMs: number,
  log: (tag: string, msg: string) => void,
  onStuck: () => void
): void {
  const calcStartRef = useRef<number | null>(null);
  const firedRef     = useRef(false);
  const logRef       = useRef(log);
  const onStuckRef   = useRef(onStuck);
  logRef.current   = log;
  onStuckRef.current = onStuck;

  useEffect(() => {
    if (!isCalculating) {
      calcStartRef.current = null;
      firedRef.current = false;
      return;
    }

    // Calculation just started
    if (calcStartRef.current === null) {
      calcStartRef.current = Date.now();
    }

    const timer = setInterval(() => {
      if (calcStartRef.current === null || firedRef.current) return;
      const elapsedMs = Date.now() - calcStartRef.current;
      if (elapsedMs >= stuckThresholdMs) {
        firedRef.current = true;
        logRef.current(
          'WATCHDOG',
          `STUCK_CALCULATION — ${Math.round(elapsedMs / 1000)}s elapsed, threshold ${stuckThresholdMs / 1000}s`
        );
        onStuckRef.current();
      }
    }, CHECK_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [isCalculating, stuckThresholdMs]);
}
