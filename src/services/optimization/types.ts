import type { Stop } from '../../models/Stop';

export type OptimizationStrategy =
  | 'preserve_import_order'
  | 'nearest_neighbor'
  | 'geographic_clustering'
  | 'directional_sweep';

export interface RouteMetrics {
  totalDistanceMiles: number;
  estimatedTimeMinutes: number;
  stopCount: number;
}

export interface OptimizationResult {
  strategy: OptimizationStrategy;
  stops: Stop[];
  metrics: RouteMetrics;
  originalMetrics: RouteMetrics;
  efficiencyScore: number; // 0–100, distance reduction %
}
