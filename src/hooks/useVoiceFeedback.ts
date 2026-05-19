import { useState, useCallback } from 'react';
import * as Speech from 'expo-speech';

export type VoiceEvent = 'arrived' | 'next_stop' | 'recalculating' | 'gps_weak';

const VOICE_LINES: Record<VoiceEvent, string> = {
  arrived:       'Arrived at stop.',
  next_stop:     'Proceeding to next stop.',
  recalculating: 'Route recalculating.',
  gps_weak:      'G P S signal weak.',
};

export interface VoiceFeedbackResult {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  speak: (event: VoiceEvent) => void;
}

/**
 * Isolated voice feedback service.
 * - Zero SDK calls, zero UI, zero orchestration side-effects.
 * - Cancels in-progress utterance before each new speak so output is immediate.
 */
export function useVoiceFeedback(): VoiceFeedbackResult {
  const [enabled, setEnabled] = useState(false);

  const speak = useCallback(
    (event: VoiceEvent) => {
      if (!enabled) return;
      Speech.stop();
      Speech.speak(VOICE_LINES[event], { language: 'en-US', pitch: 1.0, rate: 0.88 });
    },
    [enabled]
  );

  return { enabled, setEnabled, speak };
}
