import type { Stop } from '../../models/Stop';
import type { OptimizationStrategy, OptimizationResult } from './types';
import { calculateRouteMetrics } from './calculateRouteMetrics';
import { nearestNeighbor, directionalSweep } from './sequencingStrategies';
import { geographicClustering } from './clusterStops';

function renumber(stops: Stop[]): Stop[] {
  return stops.map((s, i) => ({ ...s, sequenceNumber: i + 1 }));
}

function validateNoLoss(original: Stop[], optimized: Stop[]): void {
  if (original.length !== optimized.length) {
    throw new Error(
      `OPTIMIZATION_SAFETY_FAIL: stop count changed ${original.length} → ${optimized.length}`
    );
  }
  const origIds = new Set(original.map((s) => s.id));
  for (const s of optimized) {
    if (!origIds.has(s.id)) {
      throw new Error(`OPTIMIZATION_SAFETY_FAIL: unexpected stop id ${s.id}`);
    }
  }
  const optIds = new Set(optimized.map((s) => s.id));
  for (const s of original) {
    if (!optIds.has(s.id)) {
      throw new Error(`OPTIMIZATION_SAFETY_FAIL: stop ${s.id} was lost`);
    }
  }
}

export function optimizeRoute(
  stops: Stop[],
  strategy: OptimizationStrategy,
  log: (tag: string, msg: string) => void
): OptimizationResult {
  log('OPTIMIZE', `OPTIMIZATION_STARTED — ${stops.length} stops  strategy:${strategy}`);

  const originalMetrics = calculateRouteMetrics(stops);

  let reordered: Stop[];
  switch (strategy) {
    case 'preserve_import_order':
      reordered = [...stops];
      break;
    case 'nearest_neighbor':
      reordered = nearestNeighbor(stops);
      break;
    case 'geographic_clustering':
      reordered = geographicClustering(stops);
      break;
    case 'directional_sweep':
      reordered = directionalSweep(stops);
      break;
  }

  validateNoLoss(stops, reordered);

  const finalStops = renumber(reordered);
  const metrics = calculateRouteMetrics(finalStops);

  const efficiencyScore =
    originalMetrics.totalDistanceMiles > 0
      ? Math.max(
          0,
          Math.min(
            100,
            (1 - metrics.totalDistanceMiles / originalMetrics.totalDistanceMiles) * 100
          )
        )
      : 0;

  log('OPTIMIZE', `STRATEGY_USED — ${strategy}`);
  log(
    'OPTIMIZE',
    `ESTIMATED_DISTANCE — ${metrics.totalDistanceMiles.toFixed(2)} mi (was ${originalMetrics.totalDistanceMiles.toFixed(2)} mi)`
  );
  log(
    'OPTIMIZE',
    `ESTIMATED_TIME — ${Math.round(metrics.estimatedTimeMinutes)} min (was ${Math.round(originalMetrics.estimatedTimeMinutes)} min)`
  );
  log('OPTIMIZE', `OPTIMIZATION_COMPLETED — efficiency: ${efficiencyScore.toFixed(1)}%`);

  return { strategy, stops: finalStops, metrics, originalMetrics, efficiencyScore };
}
