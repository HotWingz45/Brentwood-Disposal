import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Dimensions,
} from 'react-native';
import { showDebugUI } from '../config/environment';
import { useRouteImport } from '../hooks/useRouteImport';
import { useGeocoding } from '../hooks/useGeocoding';
import { useOptimization } from '../hooks/useOptimization';
import { StopStatus, type Stop } from '../models/Stop';
import type { ImportedStop, ImportResult } from '../services/routeImport';
import type { OptimizationStrategy, OptimizationResult } from '../services/optimization/types';
import { verifyRouteIntegrity } from '../services/routeIntegrity';

// ── Layout constants ──────────────────────────────────────────────

const WINDOW_H     = Dimensions.get('window').height;
const BOTTOM_SAFE  = Platform.OS === 'ios' ? 34 : 0;
// Sheet always occupies at least 80% of screen height — ensures content is visible
// even on iPhone SE (667pt) where 80% = ~534pt.
const SHEET_MIN_H  = Math.round(WINDOW_H * 0.80);
const SHEET_MAX_H  = Math.round(WINDOW_H * 0.94);

// ── Helpers ───────────────────────────────────────────────────────

function importedToStops(imported: ImportedStop[]): Stop[] {
  const now = Date.now();
  return imported.map((s, i) => ({
    // Prefer parse-time stop_id when present; fall back to legacy synthetic ID.
    id: s.stop_id ?? `import-${now}-${i}`,
    address: s.address,
    latitude: s.latitude ?? 0,
    longitude: s.longitude ?? 0,
    status: StopStatus.PENDING,
    // Preserve parser-assigned sequence number when present.
    sequenceNumber: s.sequenceNumber ?? i + 1,
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
    picking_file:        'Opening file picker…',
    extracting:          'Extracting document content…',
    uploading_document:  'Uploading document…',
    extracting_remotely: 'Extracting route text…',
    parsing:             'Parsing addresses…',
    validating:          'Validating stops…',
  };
  const isRemote = phase === 'uploading_document' || phase === 'extracting_remotely';
  return (
    <View style={inner.centeredBlock}>
      <ActivityIndicator color="#1a73e8" size="large" />
      <Text style={inner.centeredLabel}>{labels[phase] ?? 'Working…'}</Text>
      {isRemote && (
        <Text style={inner.extractionSubLabel}>via document extraction service</Text>
      )}
    </View>
  );
}

function ImportErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={inner.centeredBlock}>
      <Text style={inner.errorTitle}>Import Failed</Text>
      <Text style={inner.errorMsg}>{message.replace(/^[A-Z_]+\n/, '')}</Text>
      <TouchableOpacity style={inner.retryBtn} onPress={onRetry}>
        <Text style={inner.retryText}>Try Again</Text>
      </TouchableOpacity>
    </View>
  );
}

function ExtractionNotConfiguredView({
  onPaste,
  onRetry,
}: {
  onPaste: () => void;
  onRetry: () => void;
}) {
  return (
    <View style={inner.centeredBlock}>
      <Text style={inner.pdfTitle}>PDF Import Not Available</Text>
      <Text style={inner.pdfSubtitle}>
        PDF and Word imports require a document extraction service.{'\n'}
        Use CSV, XLSX, TXT, or pasted text for now.
      </Text>
      <View style={inner.pdfOptionCard}>
        <Text style={inner.pdfOptionHead}>Recommended alternatives</Text>
        <Text style={inner.pdfOptionBody}>
          • Re-export from dispatch software as CSV or Excel{'\n'}
          • Copy addresses and paste them directly{'\n'}
          • Ask your dispatcher for a TXT or XLSX version
        </Text>
      </View>
      <View style={[inner.pdfOptionCard, inner.pdfSetupCard]}>
        <Text style={inner.pdfOptionHead}>For admins</Text>
        <Text style={inner.pdfOptionBody}>
          Set EXPO_PUBLIC_DOCUMENT_EXTRACTION_URL in your .env to enable PDF and DOCX uploads.
        </Text>
      </View>
      <TouchableOpacity style={inner.pasteQuickBtn} onPress={onPaste} activeOpacity={0.8}>
        <Text style={inner.pasteQuickBtnText}>📋  Paste Addresses Instead</Text>
      </TouchableOpacity>
      <TouchableOpacity style={inner.retryLink} onPress={onRetry} activeOpacity={0.7}>
        <Text style={inner.retryLinkText}>← Select a Different File</Text>
      </TouchableOpacity>
    </View>
  );
}

/** Landing view shown when the sheet is idle and no paste mode is active. */
function IdleLanding({
  onPickFile,
  onPaste,
}: {
  onPickFile: () => void;
  onPaste: () => void;
}) {
  return (
    <View style={inner.landingWrap}>
      {/* ── Heading ────────────────────────────────────────── */}
      <View style={inner.landingHeading}>
        <Text style={inner.landingTitle}>Import a route sheet</Text>
        <Text style={inner.landingSubtitle}>
          Choose a file or paste addresses directly.
        </Text>
        <Text style={inner.landingFormats}>CSV · XLSX · DOCX · TXT · PDF*</Text>
      </View>

      {/* ── Primary action: Import File ─────────────────────── */}
      <TouchableOpacity
        style={inner.actionCard}
        onPress={onPickFile}
        activeOpacity={0.8}
      >
        <Text style={inner.actionCardIcon}>📂</Text>
        <View style={inner.actionCardText}>
          <Text style={inner.actionCardLabel}>Import File</Text>
          <Text style={inner.actionCardSub}>
            Select a CSV, XLSX, DOCX, or TXT file from your device
          </Text>
        </View>
        <Text style={inner.actionCardArrow}>›</Text>
      </TouchableOpacity>

      {/* ── Secondary action: Paste Text ────────────────────── */}
      <TouchableOpacity
        style={[inner.actionCard, inner.actionCardSecondary]}
        onPress={onPaste}
        activeOpacity={0.8}
      >
        <Text style={inner.actionCardIcon}>📋</Text>
        <View style={inner.actionCardText}>
          <Text style={inner.actionCardLabel}>Paste Text</Text>
          <Text style={inner.actionCardSub}>
            Paste a list of addresses, one per line
          </Text>
        </View>
        <Text style={inner.actionCardArrow}>›</Text>
      </TouchableOpacity>

      {/* ── Caution note ────────────────────────────────────── */}
      <View style={inner.cautionRow}>
        <Text style={inner.cautionText}>
          * PDF and Word (DOCX) require document extraction service when not locally supported.
          CSV, XLSX, and TXT always work on-device.
        </Text>
      </View>
    </View>
  );
}

/** Paste input view shown when the user has chosen to paste addresses. */
function PasteFlowView({
  pasteContent,
  onChange,
  onParse,
  onBack,
}: {
  pasteContent: string;
  onChange: (t: string) => void;
  onParse: () => void;
  onBack: () => void;
}) {
  const canParse = pasteContent.trim().length > 0;
  return (
    <View style={inner.pasteWrap}>
      <TouchableOpacity style={inner.backLink} onPress={onBack} activeOpacity={0.7}>
        <Text style={inner.backLinkText}>← Import a file instead</Text>
      </TouchableOpacity>

      <Text style={inner.pasteHeading}>Paste route addresses</Text>
      <Text style={inner.pasteSub}>One address per line. Sequence numbers are optional.</Text>

      <TextInput
        style={inner.pasteInput}
        placeholder={'123 Maple St\n456 Oak Ave\n789 Pine Rd'}
        placeholderTextColor="#3a3a4a"
        multiline
        value={pasteContent}
        onChangeText={onChange}
        autoFocus
        autoCorrect={false}
        spellCheck={false}
        textAlignVertical="top"
      />

      <TouchableOpacity
        style={[inner.parseBtn, !canParse && inner.parseBtnDisabled]}
        onPress={onParse}
        disabled={!canParse}
        activeOpacity={0.8}
      >
        <Text style={inner.parseBtnText}>PARSE STOPS →</Text>
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
      {showDebugUI && (
        <Text style={inner.geocodeSub}>GEOCODE_STARTED · Google Geocoding API</Text>
      )}
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

function StatRow({
  label,
  value,
  good,
  bad,
}: {
  label: string;
  value: string;
  good?: boolean;
  bad?: boolean;
}) {
  return (
    <View style={inner.statRow}>
      <Text style={inner.statLabel}>{label}</Text>
      <Text style={[inner.statValue, good && inner.statGood, bad && inner.statBad]}>
        {value}
      </Text>
    </View>
  );
}

function ExtractionWarningsBanner({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <View style={inner.extractionWarnWrap}>
      <Text style={inner.extractionWarnTitle}>⚠  Extraction warnings</Text>
      {warnings.map((w, i) => (
        <Text key={i} style={inner.extractionWarnItem}>· {w}</Text>
      ))}
    </View>
  );
}

function GeocodedSummaryView({
  importResult,
  geocodedStops,
  reviewCount,
}: {
  importResult: ImportResult;
  geocodedStops: ImportedStop[];
  reviewCount: number;
}) {
  const resolved  = geocodedStops.filter((s) => s.geocodeStatus === 'resolved');
  const needsReview = importResult.needsReview ?? [];
  // Stats counts the parser-side review bucket; the live review section above
  // unifies that with failed geocodes for editing.
  const totalRows = importResult.valid.length + needsReview.length + importResult.invalid.length;
  const fileLabel = importResult.fileType === 'paste'
    ? 'Pasted text'
    : importResult.fileType.toUpperCase();

  return (
    <>
      <ExtractionWarningsBanner warnings={importResult.extractionWarnings ?? []} />
      <View style={inner.statsCard}>
        {importResult.sourceFileName ? (
          <StatRow label="File" value={importResult.sourceFileName} />
        ) : null}
        <StatRow label="Format"          value={fileLabel} />
        <StatRow label="Rows found"      value={`${totalRows}`} />
        <StatRow label="Valid addresses" value={`${importResult.valid.length}`} good={importResult.valid.length > 0} />
        {reviewCount > 0 && (
          <StatRow label="Needs review" value={`${reviewCount}`} />
        )}
        {importResult.invalid.length > 0 && (
          <StatRow label="Skipped rows"      value={`${importResult.invalid.length}`} bad />
        )}
        <View style={inner.statDivider} />
        <StatRow
          label="Ready to load"
          value={`${resolved.length} stop${resolved.length !== 1 ? 's' : ''}`}
          good={resolved.length > 0}
        />
      </View>

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

// ── Phase 3: editable review item ────────────────────────────────

interface ReviewDraft {
  address: string;
  pickup: string;
  notes: string;
}

function ReviewItemRow({
  stop,
  isEditing,
  draft,
  isBusy,
  onStartEdit,
  onCancelEdit,
  onDraftChange,
  onApprove,
  onRemove,
}: {
  stop: ImportedStop;
  isEditing: boolean;
  draft: ReviewDraft;
  isBusy: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onDraftChange: (next: ReviewDraft) => void;
  onApprove: () => void;
  onRemove: () => void;
}) {
  const reason =
    stop.geocodeStatus === 'failed'
      ? `Geocode failed — ${stop.geocodeError ?? 'unknown error'}`
      : `Low confidence ${
          typeof stop.confidence_score === 'number'
            ? stop.confidence_score.toFixed(2)
            : '—'
        }`;

  if (!isEditing) {
    return (
      <View style={inner.reviewRow}>
        <View style={inner.reviewRowText}>
          <Text style={inner.reviewAddr} numberOfLines={2}>{stop.address}</Text>
          <Text style={inner.reviewReason}>{reason}</Text>
        </View>
        <TouchableOpacity
          onPress={onStartEdit}
          style={inner.reviewActionBtn}
          activeOpacity={0.7}
          disabled={isBusy}
        >
          <Text style={inner.reviewActionText}>EDIT</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onRemove}
          style={[inner.reviewActionBtn, inner.reviewActionRemove]}
          activeOpacity={0.7}
          disabled={isBusy}
        >
          <Text style={inner.reviewActionRemoveText}>✕</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const canApprove = draft.address.trim().length >= 4 && !isBusy;

  return (
    <View style={inner.reviewEditCard}>
      <Text style={inner.reviewEditLabel}>Address</Text>
      <TextInput
        value={draft.address}
        onChangeText={(t) => onDraftChange({ ...draft, address: t })}
        style={inner.reviewInput}
        placeholder="Street, city, state"
        placeholderTextColor="#444"
        autoFocus
        autoCorrect={false}
        spellCheck={false}
      />
      <Text style={inner.reviewEditLabel}>Pickup type (optional)</Text>
      <TextInput
        value={draft.pickup}
        onChangeText={(t) => onDraftChange({ ...draft, pickup: t })}
        style={inner.reviewInput}
        placeholder="e.g. Backdoor"
        placeholderTextColor="#444"
        autoCorrect={false}
      />
      <Text style={inner.reviewEditLabel}>Notes / access code (optional)</Text>
      <TextInput
        value={draft.notes}
        onChangeText={(t) => onDraftChange({ ...draft, notes: t })}
        style={inner.reviewInput}
        placeholder="Gate code, dock instructions, etc."
        placeholderTextColor="#444"
        autoCorrect={false}
      />
      <View style={inner.reviewEditButtons}>
        <TouchableOpacity
          onPress={onCancelEdit}
          style={inner.reviewActionBtn}
          activeOpacity={0.7}
        >
          <Text style={inner.reviewActionText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onApprove}
          style={[
            inner.reviewActionBtn,
            inner.reviewActionApprove,
            !canApprove && inner.reviewActionDisabled,
          ]}
          activeOpacity={0.85}
          disabled={!canApprove}
        >
          <Text style={inner.reviewActionApproveText}>Approve & Geocode</Text>
        </TouchableOpacity>
      </View>
    </View>
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
      <View style={inner.optHeader}>
        <Text style={inner.optTitle}>ROUTE OPTIMIZATION</Text>
        <Text style={inner.optSub}>{originalStops.length} stops · 20 mph avg</Text>
      </View>

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
                {showDebugUI && (
                  <Text style={inner.stopCoords}>
                    {s.latitude.toFixed(5)}, {s.longitude.toFixed(5)}
                  </Text>
                )}
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
  onLoadRoute: (stops: Stop[], wasOptimized: boolean) => void;
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

  const [showPaste, setShowPaste]       = useState(false);
  const [pasteContent, setPasteContent] = useState('');
  const [currentStrategy, setCurrentStrategy] =
    useState<OptimizationStrategy>('nearest_neighbor');

  // ── Phase 3: correction-layer state ──────────────────────────
  // Approved corrections keyed by parser-assigned stop_id. The corrected
  // ImportedStop is rebuilt with confidence_score=1, validation_status='valid',
  // geocodeStatus='pending'. It then re-enters geo.run() and gets geocoded.
  const [corrections, setCorrections] = useState<Map<string, ImportedStop>>(new Map());
  // Stops the user dismissed — excluded from review list, navigator, geocoding.
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  // Inline editor: one row at a time. null = no row in edit mode.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftAddress, setDraftAddress] = useState('');
  const [draftPickup, setDraftPickup] = useState('');
  const [draftNotes, setDraftNotes] = useState('');

  // ── Debug event logging ───────────────────────────────────────
  useEffect(() => {
    if (visible) log('IMPORT_MODAL_OPENED', 'route import sheet opened');
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const LOADING_PHASES = new Set([
    'picking_file', 'extracting', 'uploading_document', 'extracting_remotely',
    'parsing', 'validating',
  ]);
  const isIdle = phase === 'idle' || (!LOADING_PHASES.has(phase) && phase !== 'error' && phase !== 'parsed');

  useEffect(() => {
    if (visible && isIdle) {
      log('IMPORT_IDLE_RENDERED', 'landing view visible');
      log('IMPORT_ACTION_VISIBLE', 'file and paste buttons visible');
    }
  }, [visible, isIdle]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Stable Stop[] from geocoded results ──────────────────────
  // Removed stops are filtered out here — final guarantee that dismissed
  // items cannot reach the navigator even if they were geocoded earlier.
  const resolvedImportedStops = useMemo(
    () =>
      (geo.stops ?? []).filter(
        (s) =>
          s.geocodeStatus === 'resolved' &&
          !removedIds.has(s.stop_id ?? ''),
      ),
    [geo.stops, removedIds]
  );
  const resolvedStopsMapped = useMemo(
    () => importedToStops(resolvedImportedStops),
    [resolvedImportedStops]
  );

  // ── Phase 3: unified review list ─────────────────────────────
  // Combines parser-side needs_review with geocode-side failures.
  // Excludes removed and corrected-and-now-resolved items.
  const reviewItems = useMemo<ImportedStop[]>(() => {
    if (!result) return [];
    const items: ImportedStop[] = [];
    const seen = new Set<string>();

    const isResolvedInGeo = (id: string) =>
      (geo.stops ?? []).some(
        (g) => (g.stop_id ?? '') === id && g.geocodeStatus === 'resolved',
      );

    for (const s of result.needsReview ?? []) {
      const id = s.stop_id ?? '';
      if (!id || seen.has(id)) continue;
      if (removedIds.has(id)) continue;
      if (isResolvedInGeo(id)) continue;
      // Prefer the live version (with correction edits/error) when present
      const live = (geo.stops ?? []).find((g) => (g.stop_id ?? '') === id);
      items.push(live ?? corrections.get(id) ?? s);
      seen.add(id);
    }

    for (const s of geo.stops ?? []) {
      if (s.geocodeStatus !== 'failed') continue;
      const id = s.stop_id ?? '';
      if (!id || seen.has(id)) continue;
      if (removedIds.has(id)) continue;
      items.push(s);
      seen.add(id);
    }

    return items;
  }, [result, geo.stops, removedIds, corrections]);

  // ── Auto-start geocoding after parse ─────────────────────────
  useEffect(() => {
    if (phase !== 'parsed' || !result || geoStartedRef.current) return;
    geoStartedRef.current = true;
    void geo.run(result.valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, result]);

  // ── Auto-run optimization on strategy change / geocode done ──
  const isGeocodeDone = phase === 'parsed' && geo.status === 'complete';
  useEffect(() => {
    if (!isGeocodeDone || resolvedStopsMapped.length === 0) return;
    opt.run(resolvedStopsMapped, currentStrategy, log);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGeocodeDone, resolvedStopsMapped, currentStrategy]);

  // ── Derived phase flags ───────────────────────────────────────
  const isImportLoading = [
    'picking_file', 'extracting', 'uploading_document', 'extracting_remotely',
    'parsing', 'validating',
  ].includes(phase);
  const isImportError              = phase === 'error';
  const isExtractionNotConfigured  = isImportError && (error ?? '').startsWith('EXTRACTION_NOT_CONFIGURED');
  const isParsed        = phase === 'parsed';
  const isGeocoding     = isParsed && geo.status === 'resolving';
  const isGeocodeError  = isParsed && geo.status === 'error';

  // ── Handlers ──────────────────────────────────────────────────
  function fullReset() {
    importClear();
    geo.reset();
    opt.reset();
    setCurrentStrategy('nearest_neighbor');
    setShowPaste(false);
    setPasteContent('');
    geoStartedRef.current = false;
    // Phase 3: clear correction state
    setCorrections(new Map());
    setRemovedIds(new Set());
    setEditingId(null);
    setDraftAddress('');
    setDraftPickup('');
    setDraftNotes('');
  }

  // ── Phase 3: correction handlers ─────────────────────────────
  const handleStartEdit = useCallback((stop: ImportedStop) => {
    const id = stop.stop_id ?? '';
    if (!id) return;
    setEditingId(id);
    setDraftAddress(stop.address);
    setDraftPickup(stop.pickup_type ?? '');
    setDraftNotes(stop.notes ?? stop.access_code ?? '');
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setDraftAddress('');
    setDraftPickup('');
    setDraftNotes('');
  }, []);

  const handleRemoveReviewItem = useCallback(
    (id: string) => {
      if (!id) return;
      setRemovedIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      if (editingId === id) handleCancelEdit();
      log('IMPORT', `CORRECTION_REMOVED — ${id}`);
    },
    [editingId, handleCancelEdit, log],
  );

  const handleApproveReviewItem = useCallback(
    (id: string) => {
      if (!id) return;
      const trimmedAddr = draftAddress.trim();
      if (trimmedAddr.length < 4) return;

      // Find the live source — prefer geo.stops (may carry geocode error),
      // fall back to the parser's needsReview record.
      const fromGeo = (geo.stops ?? []).find((s) => (s.stop_id ?? '') === id);
      const fromReview = (result?.needsReview ?? []).find(
        (s) => (s.stop_id ?? '') === id,
      );
      const original = fromGeo ?? fromReview;
      if (!original) return;

      const corrected: ImportedStop = {
        ...original,
        address: trimmedAddr,
        pickup_type: draftPickup.trim() || undefined,
        notes: draftNotes.trim() || undefined,
        confidence_score: 1.0,
        validation_status: 'valid',
        // Force re-geocode of the corrected address
        geocodeStatus: 'pending',
        latitude: undefined,
        longitude: undefined,
        resolvedAddress: undefined,
        geocodeError: undefined,
      };

      // Rebuild the input array for geo.run: replace by stop_id if present,
      // append otherwise. Already-resolved stops pass through unchanged
      // because geocodeBatch only acts on geocodeStatus === 'pending'.
      const base = geo.stops ?? result?.valid ?? [];
      const idx = base.findIndex((s) => (s.stop_id ?? '') === id);
      let next: ImportedStop[];
      if (idx >= 0) {
        next = base.map((s, i) => (i === idx ? corrected : s));
      } else {
        next = [...base, corrected];
      }
      // Sanity: never include dismissed stops
      next = next.filter((s) => !removedIds.has(s.stop_id ?? ''));

      setCorrections((prev) => {
        const m = new Map(prev);
        m.set(id, corrected);
        return m;
      });
      handleCancelEdit();
      log(
        'IMPORT',
        `CORRECTION_APPROVED — ${id} → "${corrected.address}"`,
      );
      void geo.run(next);
    },
    [draftAddress, draftPickup, draftNotes, geo, result, removedIds, handleCancelEdit, log],
  );

  const handleClose = () => { fullReset(); onClose(); };

  const handlePickFile = async () => {
    log('IMPORT_FILE_BUTTON_PRESSED', 'opening file picker');
    setShowPaste(false);
    await pickFile();
  };

  const handleShowPaste = () => {
    log('IMPORT_PASTE_BUTTON_PRESSED', 'switching to paste mode');
    fullReset();
    setShowPaste(true);
  };

  const handleHidePaste = () => {
    setPasteContent('');
    setShowPaste(false);
  };

  const handleParse = async () => {
    if (!pasteContent.trim()) return;
    await parseText(pasteContent);
  };

  const handleRetry = () => { fullReset(); };

  const handleLoadRoute = (useOptimized: boolean) => {
    const stopsToLoad =
      useOptimized && opt.result ? opt.result.stops : resolvedStopsMapped;
    if (stopsToLoad.length === 0) return;

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
    onLoadRoute(stopsToLoad, useOptimized && hasOptResult);
    handleClose();
  };

  const canLoad      = isGeocodeDone && resolvedStopsMapped.length > 0;
  const hasOptResult = opt.result !== null;

  // ── Render ────────────────────────────────────────────────────
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      {/* Full-screen dim — covers map, debug overlay, workflow */}
      <View style={styles.dimOverlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.kavWrapper}
        >
          <View style={styles.sheet}>

            {/* ── Header ───────────────────────────────────── */}
            <View style={styles.header}>
              <View style={styles.headerPill} />
              <Text style={styles.title}>Import Route</Text>
              <TouchableOpacity onPress={handleClose} style={styles.closeBtn} activeOpacity={0.7}>
                <Text style={styles.closeText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* ── Body ─────────────────────────────────────── */}
            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {isImportLoading && <ImportLoadingView phase={phase} />}

              {isImportError && error && (
                isExtractionNotConfigured
                  ? <ExtractionNotConfiguredView onPaste={handleShowPaste} onRetry={handleRetry} />
                  : <ImportErrorView message={error} onRetry={handleRetry} />
              )}

              {isIdle && !showPaste && (
                <IdleLanding onPickFile={handlePickFile} onPaste={handleShowPaste} />
              )}

              {isIdle && showPaste && (
                <PasteFlowView
                  pasteContent={pasteContent}
                  onChange={setPasteContent}
                  onParse={handleParse}
                  onBack={handleHidePaste}
                />
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
                    reviewCount={reviewItems.length}
                  />
                  {reviewItems.length > 0 && (
                    <View>
                      <View style={inner.reviewHeader}>
                        <Text style={inner.reviewTitle}>
                          ⚑ {reviewItems.length} stop
                          {reviewItems.length !== 1 ? 's' : ''} need review
                        </Text>
                        <Text style={inner.reviewSub}>
                          Edit and approve to include, or remove. Not loaded into navigator until approved.
                        </Text>
                      </View>
                      {reviewItems.map((s) => {
                        const id = s.stop_id ?? '';
                        const isEditingThis = editingId === id;
                        return (
                          <ReviewItemRow
                            key={id || `review-${s.address}`}
                            stop={s}
                            isEditing={isEditingThis}
                            draft={{
                              address: draftAddress,
                              pickup: draftPickup,
                              notes: draftNotes,
                            }}
                            isBusy={geo.status === 'resolving'}
                            onStartEdit={() => handleStartEdit(s)}
                            onCancelEdit={handleCancelEdit}
                            onDraftChange={(d) => {
                              setDraftAddress(d.address);
                              setDraftPickup(d.pickup);
                              setDraftNotes(d.notes);
                            }}
                            onApprove={() => handleApproveReviewItem(id)}
                            onRemove={() => handleRemoveReviewItem(id)}
                          />
                        );
                      })}
                    </View>
                  )}
                  {resolvedStopsMapped.length > 0 && (
                    <OptimizationSection
                      originalStops={resolvedStopsMapped}
                      currentStrategy={currentStrategy}
                      onStrategyChange={setCurrentStrategy}
                      opt={opt}
                    />
                  )}
                  {resolvedStopsMapped.length === 0 && reviewItems.length === 0 && (
                    <Text style={inner.noStopsMsg}>
                      No stops could be geocoded. Check your addresses and try again.
                    </Text>
                  )}
                </>
              )}
            </ScrollView>

            {/* ── Footer ───────────────────────────────────── */}
            {(canLoad || isGeocodeError || isImportError) && (
              <View style={[styles.footer, { paddingBottom: 16 + BOTTOM_SAFE }]}>
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
      </View>
    </Modal>
  );
}

// ── Sheet-level styles ────────────────────────────────────────────

const styles = StyleSheet.create({
  // Full-screen semi-transparent backdrop — suppresses everything behind the sheet
  dimOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'flex-end',
  },
  // KAV wraps only the sheet so keyboard pushes it up without shrinking the dim
  kavWrapper: {
    width: '100%',
  },
  sheet: {
    backgroundColor: '#0e0e14',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: 1,
    borderTopColor: '#1a73e8',
    minHeight: SHEET_MIN_H,
    maxHeight: SHEET_MAX_H,
    // Clip rounded corners on child elements
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1a73e820',
  },
  headerPill: {
    // Drag pill — cosmetic, occupies no layout space
    position: 'absolute',
    top: 6,
    left: '50%',
    marginLeft: -20,
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#2a2a3a',
  },
  title: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#1a1a28',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2a2a3a',
  },
  closeText: { color: '#888', fontSize: 14, fontWeight: 'bold' },

  // Body fills all remaining space between header and footer
  body: { flex: 1 },
  bodyContent: {
    flexGrow: 1,    // allows body to expand to fill sheet height
    padding: 20,
    gap: 16,
    paddingBottom: 24,
  },

  footer: {
    paddingHorizontal: 20,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#1a73e820',
    gap: 8,
    backgroundColor: '#0e0e14',
  },
  loadBtn: {
    backgroundColor: '#00c96a',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  loadBtnWaiting: { opacity: 0.5 },
  loadBtnText: { color: '#000', fontSize: 15, fontWeight: '800', letterSpacing: 0.4 },
  altLoadBtn: { paddingVertical: 6, alignItems: 'center' },
  altLoadBtnText: { color: '#555', fontSize: 12 },
  backBtn: { paddingVertical: 8, alignItems: 'center' },
  backBtnText: { color: '#333', fontSize: 12 },
});

// ── Sub-component styles ──────────────────────────────────────────

const inner = StyleSheet.create({
  centeredBlock: { alignItems: 'center', paddingVertical: 40, gap: 16 },
  centeredLabel: { color: '#888', fontSize: 13, fontFamily: 'monospace' },

  // ── Error views ──
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

  // ── Remote extraction loading sub-label ──
  extractionSubLabel: {
    color: '#336699',
    fontSize: 10,
    fontFamily: 'monospace',
    letterSpacing: 0.4,
    marginTop: -4,
  },

  // ── Extraction warnings banner ──
  extractionWarnWrap: {
    backgroundColor: '#1a1000',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#4a3000',
    padding: 12,
    gap: 4,
  },
  extractionWarnTitle: {
    color: '#cc8800',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 2,
  },
  extractionWarnItem: {
    color: '#aa7700',
    fontSize: 11,
    lineHeight: 16,
  },

  // ── Extraction not-configured view ──
  pdfTitle:    { color: '#fff', fontSize: 16, fontWeight: '700' },
  pdfSubtitle: { color: '#888', fontSize: 12, textAlign: 'center', paddingHorizontal: 8, lineHeight: 18 },
  pdfOptionCard: {
    width: '100%',
    backgroundColor: '#141420',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2a3a',
    padding: 14,
    gap: 4,
  },
  pdfSetupCard:      { borderColor: '#2a2010', backgroundColor: '#0f0f00' },
  pdfOptionHead:     { color: '#ccc', fontSize: 12, fontWeight: '700' },
  pdfOptionBody:     { color: '#666', fontSize: 11, lineHeight: 16 },
  pasteQuickBtn: {
    backgroundColor: '#0d2a70',
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 28,
    borderWidth: 1.5,
    borderColor: '#1a73e8',
    marginTop: 4,
  },
  pasteQuickBtnText: { color: '#4da6ff', fontSize: 14, fontWeight: '700' },
  retryLink:         { paddingVertical: 8 },
  retryLinkText:     { color: '#444', fontSize: 12 },

  // ── Idle landing ──
  landingWrap: { gap: 16, flex: 1 },
  landingHeading: { gap: 4, paddingBottom: 4 },
  landingTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  landingSubtitle: {
    color: '#888',
    fontSize: 14,
    lineHeight: 20,
  },
  landingFormats: {
    color: '#1a73e8',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
    marginTop: 2,
  },

  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#14141f',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#1a73e8',
    paddingVertical: 18,
    paddingHorizontal: 18,
    gap: 14,
  },
  actionCardSecondary: {
    borderColor: '#2a2a3a',
    backgroundColor: '#111118',
  },
  actionCardIcon: { fontSize: 28 },
  actionCardText: { flex: 1, gap: 3 },
  actionCardLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  actionCardSub: {
    color: '#555',
    fontSize: 12,
    lineHeight: 16,
  },
  actionCardArrow: {
    color: '#2a2a4a',
    fontSize: 22,
    fontWeight: '300',
  },

  cautionRow: {
    backgroundColor: '#1a1200',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3a2a00',
    padding: 12,
  },
  cautionText: {
    color: '#aa7700',
    fontSize: 11,
    lineHeight: 16,
  },

  // ── Paste flow ──
  pasteWrap: { gap: 14, flex: 1 },
  backLink: { paddingVertical: 2 },
  backLinkText: { color: '#1a73e8', fontSize: 13, fontWeight: '600' },
  pasteHeading: { color: '#fff', fontSize: 17, fontWeight: '700' },
  pasteSub:     { color: '#666', fontSize: 12, lineHeight: 18 },
  pasteInput: {
    backgroundColor: '#111118',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2a2a3a',
    color: '#fff',
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    padding: 14,
    minHeight: 180,
    textAlignVertical: 'top',
    flex: 1,
  },
  parseBtn: {
    backgroundColor: '#1a73e8',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  parseBtnDisabled: { opacity: 0.3 },
  parseBtnText: { color: '#fff', fontSize: 14, fontWeight: '700', letterSpacing: 0.5 },

  // ── Geocoding progress ──
  geocodeTitle:    { color: '#fff', fontSize: 14, fontWeight: '600' },
  geocodeProgress: { color: '#1a73e8', fontSize: 13, fontFamily: 'monospace' },
  dotRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'center' },
  dot:         { width: 10, height: 10, borderRadius: 5, backgroundColor: '#2a2a3a' },
  dotResolved: { backgroundColor: '#00c96a' },
  dotFailed:   { backgroundColor: '#ff4444' },
  geocodeSub:  { color: '#333', fontSize: 9, fontFamily: 'monospace', letterSpacing: 0.4 },

  // ── Stats card ──
  statsCard: {
    backgroundColor: '#0d0d16',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1a73e820',
    paddingVertical: 4,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#ffffff06',
  },
  statLabel:   { color: '#555', fontSize: 12 },
  statValue:   { color: '#888', fontSize: 12, fontWeight: '600', fontFamily: 'monospace' },
  statGood:    { color: '#00c96a' },
  statBad:     { color: '#ff6644' },
  statDivider: { height: 1, backgroundColor: '#1a73e830', marginVertical: 2 },

  // ── Geocode failures ──
  failedHeader: {
    marginTop: 14,
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
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#ffffff06',
  },
  failedAddr:   { color: '#884444', fontSize: 12 },
  failedReason: { color: '#664444', fontSize: 9 },

  // ── Needs-review rows ──
  reviewHeader: {
    marginTop: 14,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#aa770022',
    gap: 2,
  },
  reviewTitle:  { color: '#cc9900', fontSize: 12, fontWeight: '700' },
  reviewSub:    { color: '#665533', fontSize: 9 },
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#ffffff06',
    gap: 8,
  },
  reviewRowText: { flex: 1, gap: 2 },
  reviewAddr:   { color: '#cca066', fontSize: 12 },
  reviewReason: { color: '#886633', fontSize: 9, fontFamily: 'monospace' },
  reviewActionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#553300',
    backgroundColor: '#1a1200',
  },
  reviewActionText: { color: '#cc9900', fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  reviewActionRemove: { borderColor: '#552020', backgroundColor: '#1a0808' },
  reviewActionRemoveText: { color: '#ff6644', fontSize: 12, fontWeight: '700' },
  reviewActionApprove: { borderColor: '#1a73e8', backgroundColor: '#0d2a70' },
  reviewActionApproveText: { color: '#4da6ff', fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  reviewActionDisabled: { opacity: 0.4 },

  // ── Inline edit card ──
  reviewEditCard: {
    backgroundColor: '#141420',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3a2a00',
    padding: 12,
    gap: 8,
    marginVertical: 6,
  },
  reviewEditLabel: { color: '#888', fontSize: 10, fontWeight: '600', letterSpacing: 0.3 },
  reviewInput: {
    backgroundColor: '#0a0a12',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#2a2a3a',
    color: '#fff',
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  reviewEditButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 4,
  },

  // ── Invalid rows ──
  invalidHeader: {
    marginTop: 14,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#aa550022',
  },
  invalidTitle: { color: '#aa7700', fontSize: 11, fontWeight: '700' },
  invalidRow: {
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#ffffff06',
    gap: 2,
  },
  invalidLine:   { color: '#666', fontSize: 10, fontFamily: 'monospace' },
  invalidReason: { color: '#885500', fontSize: 9 },

  // ── Stop list rows ──
  stopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 7,
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

  noStopsMsg: {
    color: '#ff6666',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 20,
    lineHeight: 20,
  },

  // ── Optimization section ──
  optSection: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1a73e830',
    paddingTop: 14,
    gap: 12,
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
    paddingVertical: 9,
    paddingHorizontal: 10,
    alignItems: 'center',
    gap: 2,
  },
  strategyPillActive:  { borderColor: '#1a73e8', backgroundColor: '#0d1f3c' },
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

  // Legacy styles kept for backward-compat (unused but safe to leave)
  resultHeader:     { borderBottomWidth: 1, borderBottomColor: '#1a73e820', paddingBottom: 10, gap: 3 },
  resultSummaryRow: { flexDirection: 'row', alignItems: 'center' },
  resultCountGood:  { color: '#00c96a', fontSize: 14, fontWeight: '700' },
  resultCountBad:   { color: '#ff6644', fontSize: 14, fontWeight: '700' },
  resultFile:       { color: '#555', fontSize: 10, fontFamily: 'monospace' },
  resultType:       { color: '#444', fontSize: 9,  fontFamily: 'monospace', letterSpacing: 0.5 },
});
