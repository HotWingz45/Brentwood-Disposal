import { getSupabaseClient, isBackendConfigured } from './supabaseClient';

function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
import { withRetry } from './retryHelper';
import {
  enqueueEvent,
  dequeueAll,
  removeFromQueue,
  incrementAttempts,
} from './offlineQueue';
import type { TelemetryEvent, TelemetryEventType } from './types';

const MAX_FLUSH_ATTEMPTS = 5;

export function buildTelemetryEvent(
  type: TelemetryEventType,
  driverId: string,
  sessionId: string,
  payload: Record<string, unknown>,
): TelemetryEvent {
  return {
    id: generateId(),
    type,
    driverId,
    sessionId,
    payload,
    createdAt: Date.now(),
  };
}

async function pushEvent(
  event: TelemetryEvent,
): Promise<void> {
  const client = getSupabaseClient();
  if (!client) throw new Error('no client');

  await withRetry(async () => {
    const { error } = await client.from('telemetry_logs').insert({
      id:         event.id,
      type:       event.type,
      driver_id:  event.driverId,
      session_id: event.sessionId,
      payload:    event.payload,
      created_at: new Date(event.createdAt).toISOString(),
    });
    if (error) throw error;
  });
}

export async function sendTelemetryEvent(
  event: TelemetryEvent,
  log: (tag: string, msg: string) => void,
): Promise<void> {
  if (!isBackendConfigured()) {
    await enqueueEvent('telemetry', event as unknown as Record<string, unknown>);
    log('TELEMETRY', `Queued offline — type:${event.type}`);
    return;
  }

  try {
    await pushEvent(event);
    log('TELEMETRY', `Sent — type:${event.type}`);
  } catch (err) {
    log('TELEMETRY', `Send failed, queuing — ${String(err)}`);
    await enqueueEvent('telemetry', event as unknown as Record<string, unknown>);
  }
}

export async function flushOfflineQueue(
  log: (tag: string, msg: string) => void,
): Promise<void> {
  if (!isBackendConfigured()) return;

  const queue = await dequeueAll();
  if (queue.length === 0) return;

  log('SYNC', `Flushing offline queue — ${queue.length} events`);

  for (const queued of queue) {
    if (queued.attempts >= MAX_FLUSH_ATTEMPTS) {
      log('SYNC', `Dropping stale queued event id:${queued.id} kind:${queued.kind}`);
      await removeFromQueue(queued.id);
      continue;
    }

    try {
      if (queued.kind === 'telemetry') {
        await pushEvent(queued.payload as unknown as TelemetryEvent);
      } else {
        // route_upload and session_state are replayed via their own sync functions
        // at the hook layer — nothing to do here for those kinds
      }
      await removeFromQueue(queued.id);
      log('SYNC', `Flushed queued event id:${queued.id} kind:${queued.kind}`);
    } catch {
      await incrementAttempts(queued.id);
      log('SYNC', `Flush failed — id:${queued.id} attempt:${queued.attempts + 1}`);
    }
  }
}
