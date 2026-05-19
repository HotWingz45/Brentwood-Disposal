import type { Stop } from '../models/Stop';

export type IntegrityResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Verifies a Stop[] before it enters the navigation engine.
 * Checks: non-empty, no duplicate IDs, finite coordinates in valid ranges,
 * no null-island (0,0), numeric sequenceNumbers.
 *
 * Call before loading imported or restored stops into the orchestrator.
 */
export function verifyRouteIntegrity(stops: Stop[]): IntegrityResult {
  if (!Array.isArray(stops) || stops.length === 0) {
    return { ok: false, reason: 'stops array is empty or invalid' };
  }

  const seenIds = new Set<string>();

  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];

    // ID uniqueness
    if (!s.id) {
      return { ok: false, reason: `stop[${i}] has no id` };
    }
    if (seenIds.has(s.id)) {
      return { ok: false, reason: `duplicate stop id "${s.id}" at index ${i}` };
    }
    seenIds.add(s.id);

    // Coordinate validity
    if (!Number.isFinite(s.latitude) || !Number.isFinite(s.longitude)) {
      return { ok: false, reason: `stop[${i}] non-finite coordinates` };
    }
    if (Math.abs(s.latitude) > 90 || Math.abs(s.longitude) > 180) {
      return { ok: false, reason: `stop[${i}] coordinates out of range (${s.latitude}, ${s.longitude})` };
    }
    if (s.latitude === 0 && s.longitude === 0) {
      return { ok: false, reason: `stop[${i}] null-island coordinates — geocode may have failed` };
    }

    // Sequence number
    if (typeof s.sequenceNumber !== 'number' || !Number.isFinite(s.sequenceNumber)) {
      return { ok: false, reason: `stop[${i}] invalid sequenceNumber` };
    }
  }

  return { ok: true };
}
