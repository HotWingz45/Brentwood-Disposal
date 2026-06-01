import type { ImportedStop } from '../routeImport/types';
import { geocodeAddress } from './geocodeAddress';
import type { BatchProgress } from './types';

const INTER_REQUEST_DELAY_MS = 120;

export async function geocodeBatch(
  stops: ImportedStop[],
  onProgress: (progress: BatchProgress) => void,
  log: (tag: string, msg: string) => void
): Promise<ImportedStop[]> {
  const pendingIndexes = stops
    .map((s, i) => (s.geocodeStatus === 'pending' ? i : -1))
    .filter((i) => i !== -1);

  const total = pendingIndexes.length;

  if (total === 0) {
    log('GEOCODE', 'GEOCODE_STARTED — no pending stops, skipping batch');
    return stops;
  }

  log('GEOCODE', `GEOCODE_STARTED — resolving ${total} address${total === 1 ? '' : 'es'}`);

  // Debug: log first 20 query strings so we can verify address quality
  const preview = pendingIndexes.slice(0, 20).map((idx, n) => `  [${n + 1}] ${stops[idx]!.address}`);
  log('GEOCODE', `GEOCODE_QUERY_PREVIEW (first ${Math.min(20, total)}):\n${preview.join('\n')}`);

  onProgress({ resolved: 0, failed: 0, total });

  const updated = [...stops];
  let resolved = 0;
  let failed = 0;

  for (let pi = 0; pi < pendingIndexes.length; pi++) {
    const stopIdx = pendingIndexes[pi]!;
    const stop = updated[stopIdx]!;

    if (pi > 0) {
      await new Promise<void>((r) => setTimeout(r, INTER_REQUEST_DELAY_MS));
    }

    const outcome = await geocodeAddress(stop.address, log);

    if (outcome.success) {
      updated[stopIdx] = {
        ...stop,
        latitude: outcome.lat,
        longitude: outcome.lng,
        geocodeStatus: 'resolved',
        resolvedAddress: outcome.formattedAddress,
        importMetadata: {
          ...stop.importMetadata,
          locationType: outcome.locationType,
          placeId: outcome.placeId,
        },
      };
      resolved++;
    } else {
      updated[stopIdx] = {
        ...stop,
        geocodeStatus: 'failed',
        geocodeError: outcome.error,
      };
      failed++;
      log('GEOCODE', `GEOCODE_FAILED — "${stop.address}": ${outcome.error}`);
    }

    onProgress({ resolved, failed, total });
  }

  log('GEOCODE', `GEOCODE_BATCH_COMPLETE — ${resolved} resolved, ${failed} failed of ${total}`);
  return updated;
}
