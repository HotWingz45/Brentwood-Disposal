import { useState, useCallback } from 'react';
import { geocodeBatch } from '../services/geocoding/geocodeBatch';
import { cacheClear } from '../services/geocoding/geocodeCache';
import type { ImportedStop } from '../services/routeImport/types';
import type { BatchProgress } from '../services/geocoding/types';

export type GeocodingStatus = 'idle' | 'resolving' | 'complete' | 'error';

interface GeoState {
  status: GeocodingStatus;
  resolved: number;
  failed: number;
  total: number;
  stops: ImportedStop[] | null;
  error: string | null;
}

const INITIAL: GeoState = {
  status: 'idle',
  resolved: 0,
  failed: 0,
  total: 0,
  stops: null,
  error: null,
};

export interface GeocodingHookResult extends GeoState {
  run: (stops: ImportedStop[]) => Promise<void>;
  clearCache: () => Promise<void>;
  reset: () => void;
}

export function useGeocoding(
  log: (tag: string, msg: string) => void
): GeocodingHookResult {
  const [state, setState] = useState<GeoState>(INITIAL);

  const run = useCallback(
    async (stops: ImportedStop[]) => {
      const pendingCount = stops.filter((s) => s.geocodeStatus === 'pending').length;

      if (pendingCount === 0) {
        // All already resolved — go straight to complete
        const resolvedCount = stops.filter((s) => s.geocodeStatus === 'resolved').length;
        setState({
          ...INITIAL,
          status: 'complete',
          resolved: resolvedCount,
          failed: stops.filter((s) => s.geocodeStatus === 'failed').length,
          total: 0,
          stops,
        });
        return;
      }

      setState({ ...INITIAL, status: 'resolving', total: pendingCount });

      try {
        const updated = await geocodeBatch(
          stops,
          (p: BatchProgress) =>
            setState((prev) => ({
              ...prev,
              resolved: p.resolved,
              failed: p.failed,
              total: p.total,
            })),
          log
        );

        const resolvedCount = updated.filter((s) => s.geocodeStatus === 'resolved').length;
        const failedCount = updated.filter((s) => s.geocodeStatus === 'failed').length;

        setState({
          status: 'complete',
          resolved: resolvedCount,
          failed: failedCount,
          total: pendingCount,
          stops: updated,
          error: null,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log('GEOCODE', `Batch error: ${msg}`);
        setState((prev) => ({ ...prev, status: 'error', error: msg }));
      }
    },
    [log]
  );

  const clearCache = useCallback(async () => {
    await cacheClear();
    log('GEOCODE', 'Geocode cache cleared');
  }, [log]);

  const reset = useCallback(() => {
    setState(INITIAL);
  }, []);

  return { ...state, run, clearCache, reset };
}
