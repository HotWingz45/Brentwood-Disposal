import type { ImportedStop, InvalidRow } from './types';
import { CONFIDENCE_REVIEW_THRESHOLD } from './types';
import { normalizeAddressForCompare } from './normalizeStops';

const ADDRESS_RE = /\d|[A-Za-z]{2,}/;

export interface ValidationOutput {
  valid: ImportedStop[];
  needsReview: ImportedStop[];
  invalid: InvalidRow[];
}

/**
 * Three-tier validator (Phase 2).
 *
 * Order of decisions per stop:
 *   1. Structural failures (empty / too short / not address-shaped) → invalid
 *   2. Otherwise mark as candidate-for-valid; carry forward
 *   3. After pass 1, scan candidates for duplicate normalized addresses
 *      → both copies become needs_review with reason "Duplicate address"
 *   4. Among non-duplicates, any candidate with confidence < threshold AND
 *      not pre-resolved (no embedded lat/lng) → needs_review
 *   5. Remaining candidates → valid
 *
 * `validation_status` is stamped on each stop in all three buckets so that
 * downstream code can recover the status without re-running rules.
 */
export function validateStops(
  candidates: ImportedStop[],
  prior: InvalidRow[],
): ValidationOutput {
  const invalid: InvalidRow[] = [...prior];

  // ── Pass 1: structural filter ──────────────────────────────────
  const passing: ImportedStop[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const stop = candidates[i]!;
    const addr = stop.address.trim();

    if (!addr) {
      invalid.push({ rawLine: stop.rawLine, lineNumber: i + 1, reason: 'Empty address after normalization' });
      continue;
    }
    if (addr.length < 8) {
      invalid.push({ rawLine: stop.rawLine, lineNumber: i + 1, reason: 'Address too short' });
      continue;
    }
    if (!ADDRESS_RE.test(addr)) {
      invalid.push({ rawLine: stop.rawLine, lineNumber: i + 1, reason: 'Does not look like an address' });
      continue;
    }

    passing.push(stop);
  }

  // ── Pass 2: duplicate detection ────────────────────────────────
  const byNormalized = new Map<string, number[]>();
  for (let i = 0; i < passing.length; i++) {
    const key = normalizeAddressForCompare(passing[i]!.address);
    if (!key) continue;
    const arr = byNormalized.get(key) ?? [];
    arr.push(i);
    byNormalized.set(key, arr);
  }
  const duplicateIdx = new Set<number>();
  for (const indexes of byNormalized.values()) {
    if (indexes.length > 1) {
      for (const idx of indexes) duplicateIdx.add(idx);
    }
  }

  // ── Pass 3: split into valid / needs_review ────────────────────
  const valid: ImportedStop[] = [];
  const needsReview: ImportedStop[] = [];

  for (let i = 0; i < passing.length; i++) {
    const stop = passing[i]!;
    const isDuplicate = duplicateIdx.has(i);
    const score = stop.confidence_score ?? 0.5;
    // Pre-resolved stops (lat/lng in source) bypass the confidence gate
    const preResolved = stop.geocodeStatus === 'resolved';
    const lowConfidence = !preResolved && score < CONFIDENCE_REVIEW_THRESHOLD;

    if (isDuplicate || lowConfidence) {
      needsReview.push({ ...stop, validation_status: 'needs_review' });
    } else {
      valid.push({ ...stop, validation_status: 'valid' });
    }
  }

  return { valid, needsReview, invalid };
}
