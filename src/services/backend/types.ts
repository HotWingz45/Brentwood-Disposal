// ── Sync state ────────────────────────────────────────────────────

export type SyncStatus =
  | 'idle'
  | 'syncing'
  | 'synced'
  | 'failed'
  | 'offline_queue';

// ── Driver identity ───────────────────────────────────────────────

export interface DriverProfile {
  /** Local UUID — replaced with auth user ID in a future auth stage. */
  id: string;
  createdAt: number;
  deviceInfo: string;
}

// ── Telemetry ─────────────────────────────────────────────────────

export type TelemetryEventType =
  | 'stop_completed'
  | 'stop_skipped'
  | 'arrival_detected'
  | 'route_resumed'
  | 'gps_stale'
  | 'offline_mode_entered'
  | 'optimization_applied';

export interface TelemetryEvent {
  id: string;
  type: TelemetryEventType;
  driverId: string;
  sessionId: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

// ── Route / session uploads ───────────────────────────────────────

export interface StopUpload {
  id: string;
  address: string;
  latitude: number;
  longitude: number;
  sequenceNumber: number;
  status: string;
}

export interface RouteUpload {
  sessionId: string;
  driverId: string;
  stops: StopUpload[];
  totalCount: number;
  createdAt: number;
}

export interface SessionStateUpload {
  sessionId: string;
  driverId: string;
  currentStopIndex: number;
  completedCount: number;
  skippedCount: number;
  sessionStatus: string;
  updatedAt: number;
}

// ── Offline queue ─────────────────────────────────────────────────

export type QueuedEventKind = 'telemetry' | 'route_upload' | 'session_state';

export interface QueuedEvent {
  /** Stable ID used for deduplication on flush. */
  id: string;
  kind: QueuedEventKind;
  payload: Record<string, unknown>;
  queuedAt: number;
  attempts: number;
}
