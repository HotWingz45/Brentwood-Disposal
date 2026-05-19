import type { Stop } from '../../models/Stop';

const METERS_PER_MILE = 1609.344;

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

/** Greedy nearest-neighbor traversal starting at startIndex. */
export function nearestNeighbor(stops: Stop[], startIndex = 0): Stop[] {
  if (stops.length === 0) return [];
  const unvisited = new Set(stops.map((_, i) => i));
  const result: Stop[] = [];

  let current = startIndex < stops.length ? startIndex : 0;
  unvisited.delete(current);
  result.push(stops[current]);

  while (unvisited.size > 0) {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (const idx of unvisited) {
      const d = distanceMiles(stops[current], stops[idx]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = idx;
      }
    }
    unvisited.delete(bestIdx);
    result.push(stops[bestIdx]);
    current = bestIdx;
  }

  return result;
}

/** Sorts stops by angle from the geographic centroid (angular sweep). */
export function directionalSweep(stops: Stop[]): Stop[] {
  if (stops.length === 0) return [];
  const centLat = stops.reduce((s, p) => s + p.latitude, 0) / stops.length;
  const centLng = stops.reduce((s, p) => s + p.longitude, 0) / stops.length;
  return [...stops].sort((a, b) => {
    const angleA = Math.atan2(a.latitude - centLat, a.longitude - centLng);
    const angleB = Math.atan2(b.latitude - centLat, b.longitude - centLng);
    return angleA - angleB;
  });
}
