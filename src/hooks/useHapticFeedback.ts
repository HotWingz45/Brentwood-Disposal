import { useState, useCallback } from 'react';
import * as Haptics from 'expo-haptics';

export type HapticEvent = 'arrival' | 'completion' | 'reroute' | 'error';

export interface HapticFeedbackResult {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  trigger: (event: HapticEvent) => void;
}

/**
 * Isolated haptic feedback service.
 * - Zero SDK calls, zero UI, zero orchestration side-effects.
 * - Silently swallows errors — haptics may not be available on simulator.
 */
export function useHapticFeedback(): HapticFeedbackResult {
  const [enabled, setEnabled] = useState(false);

  const trigger = useCallback(
    (event: HapticEvent) => {
      if (!enabled) return;
      const run = async () => {
        try {
          switch (event) {
            case 'arrival':
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              break;
            case 'completion':
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
              break;
            case 'reroute':
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              break;
            case 'error':
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              break;
          }
        } catch {
          // Haptics unavailable on this device/simulator — ignore
        }
      };
      void run();
    },
    [enabled]
  );

  return { enabled, setEnabled, trigger };
}
