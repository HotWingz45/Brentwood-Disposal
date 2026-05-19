import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { ConnectivityState } from '../hooks/useConnectivity';

interface FieldWarningBannerProps {
  gpsStale: boolean;
  connectivity: ConnectivityState;
  sessionRecovering?: boolean;
}

interface Warning {
  text: string;
  bg: string;
}

// Returns the highest-priority active warning, or null.
function resolveWarning(
  gpsStale: boolean,
  connectivity: ConnectivityState,
  sessionRecovering: boolean
): Warning | null {
  if (gpsStale) {
    return { text: '⚠  GPS signal lost — position may be inaccurate', bg: '#8b0000' };
  }
  if (connectivity === 'offline') {
    return { text: '◉  Offline mode — navigation continues on cached maps', bg: '#5a3000' };
  }
  if (connectivity === 'reconnecting') {
    return { text: '↺  Network restored — reconnecting…', bg: '#0a2a50' };
  }
  if (sessionRecovering) {
    return { text: '↩  SESSION_RECOVERED — previous route restored', bg: '#0d1f0d' };
  }
  return null;
}

/**
 * Thin single-line warning strip.
 * Renders nothing when there are no active warnings.
 * pointerEvents="none" — never intercepts map or overlay touches.
 */
export function FieldWarningBanner({
  gpsStale,
  connectivity,
  sessionRecovering = false,
}: FieldWarningBannerProps) {
  const warning = resolveWarning(gpsStale, connectivity, sessionRecovering);
  if (!warning) return null;

  return (
    <View style={[styles.banner, { backgroundColor: warning.bg }]} pointerEvents="none">
      <Text style={styles.text} numberOfLines={1}>{warning.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#ffffff15',
  },
  text: {
    color: '#fff',
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
