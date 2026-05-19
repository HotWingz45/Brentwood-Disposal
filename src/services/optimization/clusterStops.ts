import type { Stop } from '../../models/Stop';
import { nearestNeighbor } from './sequencingStrategies';

/**
 * Grid-based geographic clustering.
 * Divides the bounding box into a sqrt(n/3) × sqrt(n/3) grid,
 * traverses cells in a snake pattern (boustrophedon), and applies
 * nearest-neighbor within each cell.
 */
export function geographicClustering(stops: Stop[]): Stop[] {
  if (stops.length <= 3) return nearestNeighbor(stops);

  const lats = stops.map((s) => s.latitude);
  const lngs = stops.map((s) => s.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const gridSize = Math.max(2, Math.ceil(Math.sqrt(stops.length / 3)));
  const latRange = maxLat - minLat || 0.001;
  const lngRange = maxLng - minLng || 0.001;

  const cells = new Map<number, Stop[]>();
  for (const stop of stops) {
    const col = Math.min(
      Math.floor(((stop.longitude - minLng) / lngRange) * gridSize),
      gridSize - 1
    );
    const row = Math.min(
      Math.floor(((stop.latitude - minLat) / latRange) * gridSize),
      gridSize - 1
    );
    const key = row * gridSize + col;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key)!.push(stop);
  }

  const result: Stop[] = [];
  for (let row = 0; row < gridSize; row++) {
    // Snake pattern: left→right on even rows, right→left on odd rows
    const cols =
      row % 2 === 0
        ? Array.from({ length: gridSize }, (_, i) => i)
        : Array.from({ length: gridSize }, (_, i) => gridSize - 1 - i);
    for (const col of cols) {
      const key = row * gridSize + col;
      const cellStops = cells.get(key);
      if (!cellStops || cellStops.length === 0) continue;
      result.push(...nearestNeighbor(cellStops));
    }
  }

  return result;
}
