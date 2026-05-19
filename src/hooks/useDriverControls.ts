import { useRef, useCallback } from 'react';
import { Alert } from 'react-native';

const COMPLETE_COOLDOWN_MS = 2_000;
const SKIP_DEBOUNCE_MS = 800;
const CONSECUTIVE_SKIP_THRESHOLD = 2; // Alert fires on the (N+1)th consecutive skip

export interface DriverControlsResult {
  /**
   * Calls onComplete after enforcing a 2-second cooldown.
   * Resets the consecutive-skip counter on every successful complete.
   */
  guardedComplete: (onComplete: () => void) => void;
  /**
   * Calls onSkip after enforcing an 800ms debounce.
   * Shows a confirmation Alert if the driver has already skipped
   * CONSECUTIVE_SKIP_THRESHOLD stops in a row.
   */
  guardedSkip: (onSkip: () => void) => void;
}

/**
 * Isolated driver interaction safety layer.
 * - Zero SDK calls, zero UI state, zero persistence.
 * - All safety logic is ref-based — no renders triggered.
 */
export function useDriverControls(
  log: (tag: string, msg: string) => void
): DriverControlsResult {
  const lastCompleteRef      = useRef<number>(0);
  const lastSkipRef          = useRef<number>(0);
  const consecutiveSkipsRef  = useRef<number>(0);

  const guardedComplete = useCallback(
    (onComplete: () => void) => {
      const now = Date.now();
      if (now - lastCompleteRef.current < COMPLETE_COOLDOWN_MS) {
        log('DRIVER', 'DOUBLE_COMPLETE_BLOCKED — cooldown active');
        return;
      }
      lastCompleteRef.current     = now;
      consecutiveSkipsRef.current = 0;
      onComplete();
    },
    [log]
  );

  const guardedSkip = useCallback(
    (onSkip: () => void) => {
      const now = Date.now();
      if (now - lastSkipRef.current < SKIP_DEBOUNCE_MS) {
        log('DRIVER', 'RAPID_SKIP_BLOCKED — debounce');
        return;
      }
      lastSkipRef.current = now;

      const streak = consecutiveSkipsRef.current;
      if (streak >= CONSECUTIVE_SKIP_THRESHOLD) {
        Alert.alert(
          'Skip Again?',
          `You've already skipped ${streak} stop${streak !== 1 ? 's' : ''} in a row.\nAre you sure?`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Skip',
              style: 'destructive',
              onPress: () => {
                consecutiveSkipsRef.current += 1;
                log('DRIVER', `CONSECUTIVE_SKIP_CONFIRMED — streak: ${consecutiveSkipsRef.current}`);
                onSkip();
              },
            },
          ]
        );
      } else {
        consecutiveSkipsRef.current += 1;
        onSkip();
      }
    },
    [log]
  );

  return { guardedComplete, guardedSkip };
}
