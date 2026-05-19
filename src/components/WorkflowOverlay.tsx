import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { StopStatus, type Stop } from '../models/Stop';

// Home indicator on iPhone X and later — no native safe-area dependency required
const BOTTOM_SAFE = Platform.OS === 'ios' ? 34 : 0;

interface WorkflowOverlayProps {
  currentStop: Stop | null;
  nextStop: Stop | null;
  completedCount: number;
  skippedCount: number;
  remainingCount: number;
  totalCount: number;
  isFinished: boolean;
  routeStatus: string;
  guidanceActive: boolean;
  distanceToStop: number | null; // feet
  /** Estimated drive time for remaining stops at 20 mph. */
  estimatedRemainingMinutes: number;
  /** 0–100 completion percentage. */
  completedPercent: number;
  /** When true, debug overlay is hidden upstream. */
  focusMode: boolean;
  onToggleFocusMode: () => void;
  onComplete: () => void;
  onSkip: () => void;
  /** Extra bottom padding in px — caller passes 0 for Android, safe-inset for iOS. */
  bottomInset?: number;
}

const RouteStatus_OK = 'OK'; // avoid SDK import in UI layer

export function WorkflowOverlay({
  currentStop,
  nextStop,
  completedCount,
  skippedCount,
  remainingCount,
  totalCount,
  isFinished,
  routeStatus,
  guidanceActive,
  distanceToStop,
  estimatedRemainingMinutes,
  completedPercent,
  focusMode,
  onToggleFocusMode,
  onComplete,
  onSkip,
  bottomInset = BOTTOM_SAFE,
}: WorkflowOverlayProps) {
  const status     = currentStop?.status ?? StopStatus.PENDING;
  const isArrived  = status === StopStatus.ARRIVED;
  const buttonsDisabled =
    !guidanceActive || (routeStatus !== RouteStatus_OK && routeStatus !== '—');

  if (isFinished) {
    return (
      <View style={[styles.container, { paddingBottom: 8 + bottomInset }]}>
        <View style={styles.finishedCard}>
          <Text style={styles.finishedTitle}>Route Complete</Text>
          <Text style={styles.finishedSub}>
            ✓ {completedCount} completed · ⤳ {skippedCount} skipped
          </Text>
        </View>
      </View>
    );
  }

  const etaText =
    estimatedRemainingMinutes < 1
      ? '< 1 min'
      : `~${Math.round(estimatedRemainingMinutes)} min`;

  const distText =
    distanceToStop === null
      ? null
      : distanceToStop < 5280
      ? `${Math.round(distanceToStop)} ft`
      : `${(distanceToStop / 5280).toFixed(1)} mi`;

  const barPercent = Math.max(0, Math.min(100, completedPercent));

  return (
    <View style={[styles.container, { paddingBottom: 10 + bottomInset }]}>
      {/* ── HUD row ───────────────────────────────────────────────── */}
      <View style={styles.hudRow}>
        <View style={styles.hudLeft}>
          <Text style={styles.hudStopLabel}>
            Stop <Text style={styles.hudStopNum}>{currentStop?.sequenceNumber ?? '—'}</Text>
            <Text style={styles.hudStopTotal}> / {totalCount}</Text>
          </Text>
        </View>
        <View style={styles.hudCenter}>
          <View style={styles.hudBarTrack}>
            <View style={[styles.hudBarFill, { width: `${barPercent}%` as `${number}%` }]} />
          </View>
          <Text style={styles.hudMeta}>
            {completedPercent}% · {etaText} left
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.focusBtn, focusMode && styles.focusBtnActive]}
          onPress={onToggleFocusMode}
          activeOpacity={0.7}
        >
          <Text style={[styles.focusBtnText, focusMode && styles.focusBtnTextActive]}>
            {focusMode ? '◉' : '○'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Current stop card ─────────────────────────────────────── */}
      <View style={styles.currentCard}>
        <View style={[styles.seqBadge, isArrived && styles.seqBadgeArrived]}>
          <Text style={styles.seqText}>{currentStop?.sequenceNumber}</Text>
        </View>

        <View style={styles.addressBlock}>
          <View style={styles.statusRow}>
            <StatusBadge status={status} />
            {distText !== null && (
              <Text style={styles.distanceText}>{distText}</Text>
            )}
          </View>
          <Text style={styles.address} numberOfLines={2}>
            {currentStop?.address ?? '—'}
          </Text>
          {routeStatus === 'CALCULATING' && (
            <Text style={styles.calculating}>Calculating truck-safe route…</Text>
          )}
          {routeStatus !== RouteStatus_OK &&
            routeStatus !== 'CALCULATING' &&
            routeStatus !== '—' && (
              <Text style={styles.routeError}>Route error: {routeStatus}</Text>
            )}
        </View>
      </View>

      {/* ── Next stop preview ─────────────────────────────────────── */}
      {nextStop && (
        <View style={styles.nextRow}>
          <Text style={styles.nextLabel}>NEXT  </Text>
          <Text style={styles.nextAddress} numberOfLines={1}>
            {nextStop.address}
          </Text>
          <Text style={styles.nextRemaining}>{remainingCount - 1} after</Text>
        </View>
      )}

      {/* ── Action buttons ────────────────────────────────────────── */}
      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[styles.skipBtn, buttonsDisabled && styles.btnDisabled]}
          onPress={onSkip}
          disabled={buttonsDisabled}
          activeOpacity={0.65}
        >
          <Text style={styles.skipBtnText}>SKIP ↷</Text>
          <Text style={styles.skipBtnSub}>
            ⤳ {skippedCount} so far
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.completeBtn,
            isArrived && styles.completeBtnArrived,
            buttonsDisabled && styles.btnDisabled,
          ]}
          onPress={onComplete}
          disabled={buttonsDisabled}
          activeOpacity={0.75}
        >
          <Text style={[styles.completeBtnText, isArrived && styles.completeBtnTextArrived]}>
            {isArrived ? 'CONFIRM PICKUP  ✓' : 'COMPLETE  ✓'}
          </Text>
          <Text style={styles.completeBtnSub}>
            ✓ {completedCount} done
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Sub-components ────────────────────────────────────────────────

function StatusBadge({ status }: { status: StopStatus }) {
  const config: Record<StopStatus, { label: string; bg: string; text: string }> = {
    [StopStatus.PENDING]:    { label: 'PENDING',    bg: '#1e1e1e', text: '#555' },
    [StopStatus.NAVIGATING]: { label: 'EN ROUTE',   bg: '#0f1e3c', text: '#4da6ff' },
    [StopStatus.ARRIVED]:    { label: '● ARRIVED',  bg: '#003d1f', text: '#00ff88' },
    [StopStatus.COMPLETED]:  { label: 'COMPLETED',  bg: '#0d1a0d', text: '#44aa66' },
    [StopStatus.SKIPPED]:    { label: 'SKIPPED',    bg: '#1a1200', text: '#aa8800' },
  };
  const { label, bg, text } = config[status];
  return (
    <View style={[badge.wrap, { backgroundColor: bg }]}>
      <Text style={[badge.text, { color: text }]}>{label}</Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────

const badge = StyleSheet.create({
  wrap: { borderRadius: 4, paddingHorizontal: 7, paddingVertical: 3, alignSelf: 'flex-start' },
  text: { fontSize: 9, fontWeight: '700', letterSpacing: 0.6, fontFamily: 'monospace' },
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(10,10,16,0.98)',
    borderTopWidth: 2,
    borderTopColor: '#1a73e8',
  },

  // ── HUD ──
  hudRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1a73e818',
  },
  hudLeft: { width: 56 },
  hudStopLabel: { color: '#666', fontSize: 9, fontFamily: 'monospace' },
  hudStopNum:   { color: '#ccc', fontSize: 11, fontWeight: '800' },
  hudStopTotal: { color: '#555', fontSize: 9 },
  hudCenter: { flex: 1, gap: 3 },
  hudBarTrack: {
    height: 4,
    backgroundColor: '#1e1e2e',
    borderRadius: 2,
    overflow: 'hidden',
  },
  hudBarFill: {
    height: 4,
    backgroundColor: '#1a73e8',
    borderRadius: 2,
  },
  hudMeta: {
    color: '#555',
    fontSize: 9,
    fontFamily: 'monospace',
  },
  focusBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#1a1a2a',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2a2a3a',
  },
  focusBtnActive:     { backgroundColor: '#0d1f3c', borderColor: '#1a73e8' },
  focusBtnText:       { color: '#444', fontSize: 14 },
  focusBtnTextActive: { color: '#1a73e8' },

  // ── Current stop ──
  currentCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
    gap: 10,
  },
  seqBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1a73e8',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  seqBadgeArrived: { backgroundColor: '#00c96a' },
  seqText:         { color: '#fff', fontSize: 14, fontWeight: '800' },
  addressBlock:    { flex: 1, gap: 4 },
  statusRow:       { flexDirection: 'row', alignItems: 'center', gap: 8 },
  distanceText:    { color: '#888', fontSize: 10, fontFamily: 'monospace' },
  address: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 19,
    letterSpacing: 0.1,
  },
  calculating: { color: '#ffaa00', fontSize: 10, fontFamily: 'monospace' },
  routeError:  { color: '#ff4444', fontSize: 10, fontFamily: 'monospace' },

  // ── Next stop ──
  nextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderTopWidth: 1,
    borderTopColor: '#ffffff0a',
    gap: 4,
  },
  nextLabel:     { color: '#333', fontSize: 9, fontWeight: '700', letterSpacing: 0.6 },
  nextAddress:   { flex: 1, color: '#555', fontSize: 11 },
  nextRemaining: { color: '#2a2a3a', fontSize: 9, fontFamily: 'monospace' },

  // ── Buttons ──
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  skipBtn: {
    flex: 1,
    backgroundColor: '#141420',
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#2a2a44',
    gap: 3,
  },
  skipBtnText: {
    color: '#aaaaaa',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  skipBtnSub: {
    color: '#444',
    fontSize: 9,
    fontFamily: 'monospace',
  },
  completeBtn: {
    flex: 2,
    backgroundColor: '#0d2a70',
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#1a73e8',
    gap: 3,
  },
  completeBtnArrived: {
    backgroundColor: '#004d22',
    borderColor: '#00c96a',
  },
  completeBtnText: {
    color: '#4da6ff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  completeBtnTextArrived: {
    color: '#00ff88',
  },
  completeBtnSub: {
    color: '#2a4a7a',
    fontSize: 9,
    fontFamily: 'monospace',
  },
  btnDisabled: { opacity: 0.25 },

  // ── Finished ──
  finishedCard: {
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 24,
  },
  finishedTitle: { color: '#00ff88', fontSize: 20, fontWeight: '800', letterSpacing: 0.3 },
  finishedSub:   { color: '#555', fontSize: 12, marginTop: 8, fontFamily: 'monospace' },
});
