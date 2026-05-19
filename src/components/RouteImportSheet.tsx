import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouteImport } from '../hooks/useRouteImport';
import { useGeocoding } from '../hooks/useGeocoding';
import { useOptimization } from '../hooks/useOptimization';
import { StopStatus, type Stop } from '../models/Stop';
import type { ImportedStop, ImportResult } from '../services/routeImport';
import type { OptimizationStrategy, OptimizationResult } from '../services/optimization/types';
import { verifyRouteIntegrity } from '../services/routeIntegrity';

// ── Helpers ───────────────────────────────────────────────────────

function importedToStops(imported: ImportedStop[]): Stop[] {
  const now = Date.now();
  return imported.map((s, i) => ({
    id: `import-${now}-${i}`,
    address: s.address,
    latitude: s.latitude ?? 0,
    longitude: s.longitude ?? 0,
    status: StopStatus.PENDING,
    sequenceNumber: i + 1,
    geocodeStatus: s.geocodeStatus,
    rawLine: s.rawLine,
  }));
}

// ── Strategy config ───────────────────────────────────────────────

const STRATEGIES: Array<{ key: OptimizationStrategy; label: string; sub: string }> = [
  { key: 'preserve_import_order', label: 'Preserve', sub: 'as imported' },
  { key: 'nearest_neighbor',      label: 'Nearest',  sub: 'greedy path' },
  { key: 'geographic_clustering', label: 'Cluster',  sub: 'grid zones'  },
  { key: 'directional_sweep',     label: 'Sweep',    sub: 'angular sort' },
];

// ── Sub-components ────────────────────────────────────────────────

function ImportLoadingView({ phase }: { phase: string }) {
  const labels: Record<string, string> = {
    picking_file: 'Opening file picker…',
    extracting:   'Reading file…',
    parsing:      'Parsing stops…',
    validating:   'Validating…',
  };
  return (
    <View style={inner.centeredBlock}>
      <ActivityIndicator color="#1a73e8" size="large" />
      <Text style={inner.centeredLabel}>{labels[phase] ?? 'Working…'}</Text>
    </View>
  );
}

function ImportErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={inner.centeredBlock}>
      <Text style={inner.errorTitle}>Import Failed</Text>
      <Text style={inner.errorMsg}>{message}</Text>
      <TouchableOpacity style={inner.retryBtn} onPress={onRetry}>
        <Text style={inner.retryText}>Try Again</Text>
      </TouchableOpacity>
    </View>
  );
}

function GeocodingProgressView({
  resolved, failed, total,
}: { resolved: number; failed: number; total: number }) {
  const done = resolved + failed;
  return (
    <View style={inner.centeredBlock}>
      <ActivityIndicator color="#1a73e8" size="large" />
      <Text style={inner.geocodeTitle}>Resolving coordinates…</Text>
      <Text style={inner.geocodeProgress}>
        {done} of {total}{failed > 0 ? `  ·  ${failed} failed` : ''}
      </Text>
      <View style={inner.dotRow}>
        {Array.from({ length: total }).map((_, i) => {
          const isResolved = i < resolved;
          const isFailed   = i >= resolved && i < done;
          return (
            <View
              key={i}
              style={[inner.dot, isResolved && inner.dotResolved, isFailed && inner.dotFailed]}
            />
          );
        })}
      </View>
      <Text style={inner.geocodeSub}>GEOCODE_STARTED · Google Geocoding API</Text>
    </View>
  );
}

function GeocodeErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={inner.centeredBlock}>
      <Text style={inner.errorTitle}>Geocoding Failed</Text>
      <Text style={inner.errorMsg}>{message}</Text>
      <TouchableOpacity style={inner.retryBtn} onPress={onRetry}>
        <Text style={inner.retryText}>Try Again</Text>
      </TouchableOpacity>
    </View>
  );
}

/** Summary row + failed geocode + invalid rows — resolved stop list is in OptimizationSection. */
function GeocodedSummaryView({
  importResult,
  geocodedStops,
}: {
  importResult: ImportResult;
  geocodedStops: ImportedStop[];
}) {
  const resolved = geocodedStops.filter((s) => s.geocodeStatus === 'resolved');
  const failed   = geocodedStops.filter((s) => s.geocodeStatus === 'failed');

  return (
    <>
      <View style={inner.resultHeader}>
        <View style={inner.resultSummaryRow}>
          <Text style={inner.resultCountGood}>✓ {resolved.length} geocoded</Text>
          {failed.length > 0 && (
            <Text style={inner.resultCountBad}>  ✗ {failed.length} failed</Text>
          )}
        </View>
        {importResult.sourceFileName ? (
          <Text style={inner.resultFile}>{importResult.sourceFileName}</Text>
        ) : null}
        <Text style={inner.resultType}>
          {importResult.fileType === 'paste' ? 'Pasted text' : importResult.fileType.toUpperCase()}
        </Text>
      </View>

      {failed.length > 0 && (
        <>
          <View style={inner.failedHeader}>
            <Text style={inner.failedTitle}>
              ⚠ {failed.length} stop{failed.length !== 1 ? 's' : ''} could not be geocoded
            </Text>
            <Text style={inner.failedSub}>These will not be included in the route</Text>
          </View>
          {failed.map((s, i) => (
            <View key={`f-${i}`} style={inner.failedRow}>
              <View style={inner.stopSeqFail}>
                <Text style={inner.stopSeqText}>✗</Text>
              </View>
              <View style={inner.stopInfo}>
                <Text style={inner.failedAddr} numberOfLines={1}>{s.address}</Text>
                <Text style={inner.failedReason}>{s.geocodeError ?? 'Unknown error'}</Text>
              </View>
            </View>
          ))}
        </>
      )}

      {importResult.invalid.length > 0 && (
        <>
          <View style={inner.invalidHeader}>
            <Text style={inner.invalidTitle}>
              ⤳ {importResult.invalid.length} row{importResult.invalid.length !== 1 ? 's' : ''} skipped during import
            </Text>
          </View>
          {importResult.invalid.map((row, i) => (
            <View key={`i-${i}`} style={inner.invalidRow}>
              <Text style={inner.invalidLine} numberOfLines={1}>{row.rawLine || '(empty)'}</Text>
              <Text style={inner.invalidReason}>{row.reason}</Text>
            </View>
          ))}
        </>
      )}
    </>
  );
}

function MetricsRow({
  label, original, optimized,
}: { label: string; original: string; optimized: string }) {
  return (
    <View style={inner.metricsRow}>
      <Text style={inner.metricsLabel}>{label}</Text>
      <Text style={inner.metricsOrig}>{original}</Text>
      <Text style={inner.metricsOpt}>{optimized}</Text>
    </View>
  );
}

function OptimizationSection({
  originalStops,
  currentStrategy,
  onStrategyChange,
  opt,
}: {
  originalStops: Stop[];
  currentStrategy: OptimizationStrategy;
  onStrategyChange: (s: OptimizationStrategy) => void;
  opt: { status: string; result: OptimizationResult | null; error: string | null };
}) {
  const result = opt.result;

  return (
    <View style={inner.optSection}>
      {/* Section header */}
      <View style={inner.optHeader}>
        <Text style={inner.optTitle}>ROUTE OPTIMIZATION</Text>
        <Text style={inner.optSub}>{originalStops.length} stops · 20 mph avg</Text>
      </View>

      {/* Strategy selector */}
      <View style={inner.strategyGrid}>
        {STRATEGIES.map((s) => {
          const active = s.key === currentStrategy;
          return (
            <TouchableOpacity
              key={s.key}
              style={[inner.strategyPill, active && inner.strategyPillActive]}
              onPress={() => onStrategyChange(s.key)}
              activeOpacity={0.7}
            >
              <Text style={[inner.strategyLabel, active && inner.strategyLabelActive]}>
                {s.label}
              </Text>
              <Text style={[inner.strategySub, active && inner.strategySubActive]}>
                {s.sub}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Metrics comparison */}
      {result && (
        <>
          <View style={inner.metricsTable}>
            <View style={inner.metricsHeaderRow}>
              <Text style={inner.metricsHeaderLabel} />
              <Text style={inner.metricsHeaderOrig}>Original</Text>
              <Text style={inner.metricsHeaderOpt}>Optimized</Text>
            </View>
            <MetricsRow
              label="Distance"
              original={`${result.originalMetrics.totalDistanceMiles.toFixed(1)} mi`}
              optimized={`${result.metrics.totalDistanceMiles.toFixed(1)} mi`}
            />
            <MetricsRow
              label="Est. time"
              original={`${Math.round(result.originalMetrics.estimatedTimeMinutes)} min`}
              optimized={`${Math.round(result.metrics.estimatedTimeMinutes)} min`}
            />
            {result.efficiencyScore > 0 && (
              <View style={inner.metricsRow}>
                <Text style={inner.metricsLabel}>Savings</Text>
                <Text style={inner.metricsOrig} />
                <Text style={[inner.metricsOpt, inner.metricsSavings]}>
                  −{result.efficiencyScore.toFixed(1)}%
                </Text>
              </View>
            )}
          </View>

          {/* Optimized stop list */}
          <View style={inner.optStopListHeader}>
            <Text style={inner.optStopListTitle}>Optimized order</Text>
          </View>
          {result.stops.map((s, i) => (
            <View key={s.id} style={inner.stopRow}>
              <View style={inner.stopSeqOpt}>
                <Text style={inner.stopSeqText}>{i + 1}</Text>
              </View>
              <View style={inner.stopInfo}>
                <Text style={inner.stopAddr} numberOfLines={2}>{s.address}</Text>
                <Text style={inner.stopCoords}>
                  {s.latitude.toFixed(5)}, {s.longitude.toFixed(5)}
                </Text>
              </View>
            </View>
          ))}
        </>
      )}

      {opt.status === 'error' && opt.error && (
        <Text style={inner.optError}>{opt.error}</Text>
      )}
    </View>
  );
}

// ── Main component ────────────────────────────────────────────────

interface RouteImportSheetProps {
  visible: boolean;
  onClose: () => void;
  onLoadRoute: (stops: Stop[]) => void;
  log: (tag: string, msg: string) => void;
}

export function RouteImportSheet({
  visible,
  onClose,
  onLoadRoute,
  log,
}: RouteImportSheetProps) {
  const { phase, result, error, pickFile, parseText, clear: importClear } = useRouteImport(log);
  const geo = useGeocoding(log);
  const opt = useOptimization();

  const geoStartedRef = useRef(false);

  const [showPaste, setShowPaste]         = useState(false);
  const [pasteContent, setPasteContent]   = useState('');
  const [currentStrategy, setCurrentStrategy] =
    useState<OptimizationStrategy>('nearest_neighbor');

  // Stable Stop[] derived from geocoded results (IDs generated once, memoized)
  const resolvedImportedStops = useMemo(
    () => geo.stops?.filter((s) => s.geocodeStatus === 'resolved') ?? [],
    [geo.stops]
  );
  const resolvedStopsMapped = useMemo(
    () => importedToStops(resolvedImportedStops),
    [resolvedImportedStops]
  );

  // ── Auto-start geocoding after import parse ───────────────────
  useEffect(() => {
    if (phase !== 'parsed' || !result || geoStartedRef.current) return;
    geoStartedRef.current = true;
    void geo.run(result.valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, result]);

  // ── Auto-run optimization whenever geocoding is done or strategy changes ──
  const isGeocodeDone = phase === 'parsed' && geo.status === 'complete';
  useEffect(() => {
    if (!isGeocodeDone || resolvedStopsMapped.length === 0) return;
    opt.run(resolvedStopsMapped, currentStrategy, log);
    // opt.run and log are stable; resolvedStopsMapped is memoized
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGeocodeDone, resolvedStopsMapped, currentStrategy]);

  // ── Derived state ─────────────────────────────────────────────
  const isImportLoading = ['picking_file', 'extracting', 'parsing', 'validating'].includes(phase);
  const isImportError   = phase === 'error';
  const isParsed        = phase === 'parsed';
  const isGeocoding     = isParsed && geo.status === 'resolving';
  const isGeocodeError  = isParsed && geo.status === 'error';
  const isIdle          = !isImportLoading && !isImportError && !isParsed;

  // ── Handlers ──────────────────────────────────────────────────
  function fullReset() {
    importClear();
    geo.reset();
    opt.reset();
    setCurrentStrategy('nearest_neighbor');
    setShowPaste(false);
    setPasteContent('');
    geoStartedRef.current = false;
  }

  const handleClose = () => { fullReset(); onClose(); };

  const handlePickFile = async () => { setShowPaste(false); await pickFile(); };

  const handleShowPaste = () => { fullReset(); setShowPaste(true); };

  const handleParse = async () => {
    if (!pasteContent.trim()) return;
    await parseText(pasteContent);
  };

  const handleRetry = () => { fullReset(); };

  const handleLoadRoute = (useOptimized: boolean) => {
    const stopsToLoad =
      useOptimized && opt.result ? opt.result.stops : resolvedStopsMapped;
    if (stopsToLoad.length === 0) return;

    // Gate on route integrity before handing off to the navigator
    const integrity = verifyRouteIntegrity(stopsToLoad);
    if (!integrity.ok) {
      log('INTEGRITY', `ROUTE_INTEGRITY_FAIL — ${integrity.reason}`);
      log('INTEGRITY', 'Load aborted — fix your import and try again');
      return;
    }

    if (!useOptimized) {
      log('OPTIMIZE', 'OPTIMIZATION_REVERTED — user selected original import order');
    }
    log('IMPORT', `IMPORT_LOADED — ${stopsToLoad.length} stops → navigator (integrity OK)`);
    onLoadRoute(stopsToLoad);
    handleClose();
  };

  const canLoad   = isGeocodeDone && resolvedStopsMapped.length > 0;
  const hasOptResult = opt.result !== null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <View style={styles.sheet}>
          {/* ── Header ─────────────────────────────────────────── */}
          <View style={styles.header}>
            <Text style={styles.title}>Import Route</Text>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn} activeOpacity={0.7}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* ── Body ───────────────────────────────────────────── */}
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
          >
            {isImportLoading && <ImportLoadingView phase={phase} />}

            {isImportError && error && (
              <ImportErrorView message={error} onRetry={handleRetry} />
            )}

            {isIdle && (
              <>
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={handlePickFile}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.actionIcon}>📂</Text>
                    <Text style={styles.actionLabel}>Import File</Text>
                    <Text style={styles.actionSub}>CSV · XLSX · TXT</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.actionBtn, showPaste && styles.actionBtnActive]}
                    onPress={handleShowPaste}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.actionIcon}>📋</Text>
                    <Text style={styles.actionLabel}>Paste Text</Text>
                    <Text style={styles.actionSub}>One address per line</Text>
                  </TouchableOpacity>
                </View>

                {showPaste && (
                  <View style={styles.pasteBlock}>
                    <TextInput
                      style={styles.pasteInput}
                      placeholder={'123 Maple St\n456 Oak Ave\n789 Pine Rd'}
                      placeholderTextColor="#444"
                      multiline
                      value={pasteContent}
                      onChangeText={setPasteContent}
                      autoFocus
                      autoCorrect={false}
                      spellCheck={false}
                    />
                    <TouchableOpacity
                      style={[styles.parseBtn, !pasteContent.trim() && styles.parseBtnDisabled]}
                      onPress={handleParse}
                      disabled={!pasteContent.trim()}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.parseBtnText}>PARSE STOPS →</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </>
            )}

            {isGeocoding && (
              <GeocodingProgressView
                resolved={geo.resolved}
                failed={geo.failed}
                total={geo.total}
              />
            )}

            {isGeocodeError && geo.error && (
              <GeocodeErrorView message={geo.error} onRetry={handleRetry} />
            )}

            {isGeocodeDone && result && geo.stops && (
              <>
                <GeocodedSummaryView
                  importResult={result}
                  geocodedStops={geo.stops}
                />
                {resolvedStopsMapped.length > 0 && (
                  <OptimizationSection
                    originalStops={resolvedStopsMapped}
                    currentStrategy={currentStrategy}
                    onStrategyChange={setCurrentStrategy}
                    opt={opt}
                  />
                )}
                {resolvedStopsMapped.length === 0 && (
                  <Text style={inner.noStopsMsg}>
                    No stops could be geocoded. Check your addresses and try again.
                  </Text>
                )}
              </>
            )}
          </ScrollView>

          {/* ── Footer ─────────────────────────────────────────── */}
          {(canLoad || isGeocodeError || isImportError) && (
            <View style={styles.footer}>
              {canLoad && (
                <>
                  <TouchableOpacity
                    style={[styles.loadBtn, !hasOptResult && styles.loadBtnWaiting]}
                    onPress={() => handleLoadRoute(true)}
                    disabled={!hasOptResult}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.loadBtnText}>
                      {hasOptResult
                        ? `LOAD ${opt.result!.stops.length} STOPS (OPTIMIZED)  →`
                        : `LOAD ${resolvedStopsMapped.length} STOPS…`}
                    </Text>
                  </TouchableOpacity>
                  {hasOptResult && (
                    <TouchableOpacity
                      style={styles.altLoadBtn}
                      onPress={() => handleLoadRoute(false)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.altLoadBtnText}>
                        ↩ Load in original import order
                      </Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
              <TouchableOpacity
                style={styles.backBtn}
                onPress={handleRetry}
                activeOpacity={0.7}
              >
                <Text style={styles.backBtnText}>↩ Import Different File</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Sheet-level styles ────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    backgroundColor: '#0e0e14',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1,
    borderTopColor: '#1a73e8',
    maxHeight: '90%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a73e820',
  },
  title: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.4 },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#222',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: '#888', fontSize: 14, fontWeight: 'bold' },
  body: { flex: 1 },
  bodyContent: { padding: 16, gap: 12 },

  actionRow: { flexDirection: 'row', gap: 12 },
  actionBtn: {
    flex: 1,
    backgroundColor: '#161620',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2a2a3a',
    padding: 16,
    alignItems: 'center',
    gap: 4,
  },
  actionBtnActive: { borderColor: '#1a73e8', backgroundColor: '#0d1f3c' },
  actionIcon: { fontSize: 24 },
  actionLabel: { color: '#fff', fontSize: 13, fontWeight: '600' },
  actionSub: { color: '#555', fontSize: 10 },

  pasteBlock: { gap: 8 },
  pasteInput: {
    backgroundColor: '#161620',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2a3a',
    color: '#fff',
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    padding: 12,
    minHeight: 140,
    textAlignVertical: 'top',
  },
  parseBtn: {
    backgroundColor: '#1a73e8',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  parseBtnDisabled: { opacity: 0.3 },
  parseBtnText: { color: '#fff', fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },

  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#1a73e820',
    gap: 8,
  },
  loadBtn: {
    backgroundColor: '#00c96a',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  loadBtnWaiting: { opacity: 0.5 },
  loadBtnText: { color: '#000', fontSize: 14, fontWeight: '800', letterSpacing: 0.5 },
  altLoadBtn: { paddingVertical: 6, alignItems: 'center' },
  altLoadBtnText: { color: '#666', fontSize: 12 },
  backBtn: { paddingVertical: 8, alignItems: 'center' },
  backBtnText: { color: '#444', fontSize: 12 },
});

// ── Sub-component styles ──────────────────────────────────────────

const inner = StyleSheet.create({
  centeredBlock: { alignItems: 'center', paddingVertical: 36, gap: 14 },
  centeredLabel: { color: '#888', fontSize: 13, fontFamily: 'monospace' },

  errorTitle: { color: '#ff4444', fontSize: 15, fontWeight: '700' },
  errorMsg: {
    color: '#cc8888',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 8,
  },
  retryBtn: {
    backgroundColor: '#2a1010',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#882222',
    marginTop: 4,
  },
  retryText: { color: '#ff8888', fontSize: 13, fontWeight: '600' },

  geocodeTitle:    { color: '#fff', fontSize: 14, fontWeight: '600' },
  geocodeProgress: { color: '#1a73e8', fontSize: 13, fontFamily: 'monospace' },
  dotRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'center' },
  dot:         { width: 10, height: 10, borderRadius: 5, backgroundColor: '#2a2a3a' },
  dotResolved: { backgroundColor: '#00c96a' },
  dotFailed:   { backgroundColor: '#ff4444' },
  geocodeSub:  { color: '#333', fontSize: 9, fontFamily: 'monospace', letterSpacing: 0.4 },

  resultHeader:     { borderBottomWidth: 1, borderBottomColor: '#1a73e820', paddingBottom: 10, gap: 3 },
  resultSummaryRow: { flexDirection: 'row', alignItems: 'center' },
  resultCountGood:  { color: '#00c96a', fontSize: 14, fontWeight: '700' },
  resultCountBad:   { color: '#ff6644', fontSize: 14, fontWeight: '700' },
  resultFile:       { color: '#555', fontSize: 10, fontFamily: 'monospace' },
  resultType:       { color: '#444', fontSize: 9,  fontFamily: 'monospace', letterSpacing: 0.5 },

  stopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#ffffff08',
  },
  stopSeqFail: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#3a1010',
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  stopSeqOpt: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#006e3a',
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  stopSeqText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  stopInfo:    { flex: 1, gap: 2 },
  stopAddr:    { color: '#ddd', fontSize: 12, lineHeight: 16 },
  stopCoords:  { color: '#336655', fontSize: 9, fontFamily: 'monospace' },

  failedHeader: {
    marginTop: 12,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#ff444422',
    gap: 2,
  },
  failedTitle: { color: '#ff6644', fontSize: 12, fontWeight: '700' },
  failedSub:   { color: '#553333', fontSize: 9 },
  failedRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#ffffff06',
  },
  failedAddr:   { color: '#884444', fontSize: 12 },
  failedReason: { color: '#664444', fontSize: 9 },

  invalidHeader: {
    marginTop: 12,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#aa550022',
  },
  invalidTitle: { color: '#aa7700', fontSize: 11, fontWeight: '700' },
  invalidRow: {
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#ffffff06',
    gap: 2,
  },
  invalidLine:   { color: '#666', fontSize: 10, fontFamily: 'monospace' },
  invalidReason: { color: '#885500', fontSize: 9 },

  noStopsMsg: {
    color: '#ff6666',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 16,
    lineHeight: 20,
  },

  // Optimization section
  optSection: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1a73e830',
    paddingTop: 12,
    gap: 10,
  },
  optHeader:  { gap: 2 },
  optTitle:   { color: '#1a73e8', fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  optSub:     { color: '#444', fontSize: 9, fontFamily: 'monospace' },

  strategyGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  strategyPill: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#161620',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2a3a',
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
    gap: 2,
  },
  strategyPillActive: { borderColor: '#1a73e8', backgroundColor: '#0d1f3c' },
  strategyLabel:       { color: '#888', fontSize: 12, fontWeight: '600' },
  strategyLabelActive: { color: '#fff' },
  strategySub:         { color: '#444', fontSize: 9 },
  strategySubActive:   { color: '#1a73e8' },

  metricsTable: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1a73e820',
    overflow: 'hidden',
  },
  metricsHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#0d1120',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1a73e820',
  },
  metricsHeaderLabel: { flex: 1, color: '#333', fontSize: 9 },
  metricsHeaderOrig:  { width: 72, color: '#444', fontSize: 9, textAlign: 'right' },
  metricsHeaderOpt:   { width: 72, color: '#1a73e8', fontSize: 9, textAlign: 'right' },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#ffffff06',
  },
  metricsLabel:   { flex: 1, color: '#888', fontSize: 11 },
  metricsOrig:    { width: 72, color: '#555', fontSize: 11, textAlign: 'right' },
  metricsOpt:     { width: 72, color: '#00c96a', fontSize: 11, fontWeight: '600', textAlign: 'right' },
  metricsSavings: { color: '#00e97a', fontWeight: '800' },

  optStopListHeader: {
    borderBottomWidth: 1,
    borderBottomColor: '#ffffff10',
    paddingBottom: 4,
    marginTop: 4,
  },
  optStopListTitle: { color: '#336644', fontSize: 9, fontFamily: 'monospace', letterSpacing: 0.5 },

  optError: { color: '#ff6644', fontSize: 11, fontFamily: 'monospace', paddingVertical: 8 },
});
