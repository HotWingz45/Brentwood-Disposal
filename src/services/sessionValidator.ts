import { RouteSessionStatus, type RouteSession } from '../models/RouteSession';
import { StopStatus } from '../models/Stop';

export type ValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

/**
 * Validates a persisted RouteSession for structural integrity before restoring.
 * Returns { valid: false, reason } on ANY sign of corruption.
 */
export function validateSession(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, reason: 'session is not an object' };
  }
  const s = raw as Record<string, unknown>;

  if (!s.id || typeof s.id !== 'string') {
    return { valid: false, reason: 'missing or non-string id' };
  }
  if (!Object.values(RouteSessionStatus).includes(s.sessionStatus as RouteSessionStatus)) {
    return { valid: false, reason: `unknown sessionStatus: ${String(s.sessionStatus)}` };
  }
  if (!Array.isArray(s.stops) || s.stops.length === 0) {
    return { valid: false, reason: 'stops is empty or not an array' };
  }
  if (
    typeof s.currentStopIndex !== 'number' ||
    !Number.isFinite(s.currentStopIndex) ||
    s.currentStopIndex < 0 ||
    s.currentStopIndex > (s.stops as unknown[]).length
  ) {
    return {
      valid: false,
      reason: `invalid currentStopIndex: ${String(s.currentStopIndex)} for ${(s.stops as unknown[]).length} stops`,
    };
  }
  if (typeof s.createdAt !== 'number' || s.createdAt <= 0) {
    return { valid: false, reason: 'invalid createdAt timestamp' };
  }

  const stops = s.stops as unknown[];
  for (let i = 0; i < stops.length; i++) {
    const stopResult = validateStop(stops[i], i);
    if (!stopResult.valid) return stopResult;
  }

  return { valid: true };
}

function validateStop(raw: unknown, index: number): ValidationResult {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, reason: `stop[${index}] is not an object` };
  }
  const s = raw as Record<string, unknown>;

  if (!s.id || typeof s.id !== 'string') {
    return { valid: false, reason: `stop[${index}] missing id` };
  }
  if (typeof s.latitude !== 'number' || !Number.isFinite(s.latitude)) {
    return { valid: false, reason: `stop[${index}] non-finite latitude` };
  }
  if (typeof s.longitude !== 'number' || !Number.isFinite(s.longitude)) {
    return { valid: false, reason: `stop[${index}] non-finite longitude` };
  }
  if (Math.abs(s.latitude as number) > 90) {
    return { valid: false, reason: `stop[${index}] latitude out of range: ${s.latitude}` };
  }
  if (Math.abs(s.longitude as number) > 180) {
    return { valid: false, reason: `stop[${index}] longitude out of range: ${s.longitude}` };
  }
  if (s.latitude === 0 && s.longitude === 0) {
    return { valid: false, reason: `stop[${index}] null-island coordinates (0,0)` };
  }
  if (!Object.values(StopStatus).includes(s.status as StopStatus)) {
    return { valid: false, reason: `stop[${index}] unknown status: ${String(s.status)}` };
  }
  return { valid: true };
}

/** Typed wrapper — call after validateSession returns {valid:true}. */
export function castSession(raw: unknown): RouteSession {
  return raw as RouteSession;
}
