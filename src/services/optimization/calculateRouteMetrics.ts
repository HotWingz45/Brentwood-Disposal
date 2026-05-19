import type { Stop } from '../../models/Stop';
import type { RouteMetrics } from './types';

const METERS_PER_MILE = 1609.344;
const AVG_SPEED_MPH = 20;

// Local haversine — never import from hooks layer
function distanceMiles(a: Stop, b: Stop): number {
  const R = 6_371_000;
  const φ1 = (a.latitude * Math.PI) / 180;
  const φ2 = (b.latitude * Math.PI) / 180;
  const Δφ = ((b.latitude - a.latitude) * Math.PI) / 180;
  const Δλ = ((b.longitude - a.longitude) * Math.PI) / 180;
  const x =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return (2 * R * Math.asin(Math.sqrt(x))) / METERS_PER_MILE;
}

export function calculateRouteMetrics(stops: Stop[]): RouteMetrics {
  if (stops.length === 0) {
    return { totalDistanceMiles: 0, estimatedTimeMinutes: 0, stopCount: 0 };
  }
  let totalMiles = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    totalMiles += distanceMiles(stops[i], stops[i + 1]);
  }
  return {
    totalDistanceMiles: totalMiles,
    estimatedTimeMinutes: (totalMiles / AVG_SPEED_MPH) * 60,
    stopCount: stops.length,
  };
}
