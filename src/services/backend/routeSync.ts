import { getSupabaseClient, isBackendConfigured } from './supabaseClient';
import { withRetry } from './retryHelper';
import { enqueueEvent } from './offlineQueue';
import type { RouteUpload, SessionStateUpload } from './types';

export async function uploadRoute(
  upload: RouteUpload,
  log: (tag: string, msg: string) => void,
): Promise<void> {
  if (!isBackendConfigured()) {
    await enqueueEvent('route_upload', upload as unknown as Record<string, unknown>);
    log('SYNC', `Route queued offline — session:${upload.sessionId}`);
    return;
  }

  const client = getSupabaseClient();
  if (!client) return;

  try {
    await withRetry(async () => {
      const { error: routeErr } = await client.from('routes').upsert(
        {
          session_id:  upload.sessionId,
          driver_id:   upload.driverId,
          total_count: upload.totalCount,
          created_at:  new Date(upload.createdAt).toISOString(),
        },
        { onConflict: 'session_id' },
      );
      if (routeErr) throw routeErr;

      const stopRows = upload.stops.map((s) => ({
        id:              s.id,
        session_id:      upload.sessionId,
        address:         s.address,
        latitude:        s.latitude,
        longitude:       s.longitude,
        sequence_number: s.sequenceNumber,
        status:          s.status,
      }));

      const { error: stopsErr } = await client
        .from('stops')
        .upsert(stopRows, { onConflict: 'id' });
      if (stopsErr) throw stopsErr;
    });

    log('SYNC', `Route uploaded — session:${upload.sessionId} stops:${upload.stops.length}`);
  } catch (err) {
    log('SYNC', `Route upload failed, queuing — ${String(err)}`);
    await enqueueEvent('route_upload', upload as unknown as Record<string, unknown>);
  }
}

export async function uploadSessionState(
  state: SessionStateUpload,
  log: (tag: string, msg: string) => void,
): Promise<void> {
  if (!isBackendConfigured()) {
    await enqueueEvent('session_state', state as unknown as Record<string, unknown>);
    return;
  }

  const client = getSupabaseClient();
  if (!client) return;

  try {
    await withRetry(async () => {
      const { error } = await client.from('active_sessions').upsert(
        {
          session_id:          state.sessionId,
          driver_id:           state.driverId,
          current_stop_index:  state.currentStopIndex,
          completed_count:     state.completedCount,
          skipped_count:       state.skippedCount,
          session_status:      state.sessionStatus,
          updated_at:          new Date(state.updatedAt).toISOString(),
        },
        { onConflict: 'session_id' },
      );
      if (error) throw error;
    });

    log('SYNC', `Session state synced — idx:${state.currentStopIndex} status:${state.sessionStatus}`);
  } catch (err) {
    log('SYNC', `Session state sync failed, queuing — ${String(err)}`);
    await enqueueEvent('session_state', state as unknown as Record<string, unknown>);
  }
}
