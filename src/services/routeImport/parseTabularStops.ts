import Papa from 'papaparse';
import type { ImportedStop, InvalidRow } from './types';

const ADDRESS_HEADERS = ['address', 'addr', 'street', 'location', 'stop address', 'service address', 'delivery', 'pickup', 'drop off'];
const LAT_HEADERS = ['lat', 'latitude', 'y'];
const LNG_HEADERS = ['lng', 'lon', 'long', 'longitude', 'x'];
const SEQ_HEADERS = ['stop', 'stop#', 'stop #', 'seq', 'sequence', 'order', '#', 'num', 'number', 'route stop'];

const ALL_KNOWN = new Set([...ADDRESS_HEADERS, ...LAT_HEADERS, ...LNG_HEADERS, ...SEQ_HEADERS]);

function findCol(headers: string[], candidates: string[]): number {
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const c of candidates) {
    const idx = lower.indexOf(c);
    if (idx !== -1) return idx;
  }
  return -1;
}

function isHeaderRow(row: string[]): boolean {
  return row.some((cell) => ALL_KNOWN.has(cell.toLowerCase().trim()));
}

export function parseTabularStops(csv: string): {
  candidates: ImportedStop[];
  invalid: InvalidRow[];
} {
  const parsed = Papa.parse<string[]>(csv, { skipEmptyLines: true, header: false });
  const rows = parsed.data;
  if (rows.length === 0) return { candidates: [], invalid: [] };

  const candidates: ImportedStop[] = [];
  const invalid: InvalidRow[] = [];

  let startRow = 0;
  let addrCol = -1;
  let latCol = -1;
  let lngCol = -1;
  let seqCol = -1;

  const firstRow = rows[0] ?? [];
  if (isHeaderRow(firstRow)) {
    startRow = 1;
    addrCol = findCol(firstRow, ADDRESS_HEADERS);
    latCol = findCol(firstRow, LAT_HEADERS);
    lngCol = findCol(firstRow, LNG_HEADERS);
    seqCol = findCol(firstRow, SEQ_HEADERS);
  }

  if (addrCol === -1) addrCol = 0;

  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const rawLine = row.join(',');
    const rawAddr = row[addrCol]?.trim() ?? '';

    if (!rawAddr) {
      invalid.push({ rawLine, lineNumber: i + 1, reason: 'Empty address cell' });
      continue;
    }

    const stop: ImportedStop = {
      address: rawAddr,
      rawLine,
      geocodeStatus: 'pending',
    };

    if (latCol !== -1 && lngCol !== -1) {
      const lat = parseFloat(row[latCol] ?? '');
      const lng = parseFloat(row[lngCol] ?? '');
      if (!isNaN(lat) && !isNaN(lng)) {
        stop.latitude = lat;
        stop.longitude = lng;
        stop.geocodeStatus = 'resolved';
      }
    }

    if (seqCol !== -1) {
      const seq = parseInt(row[seqCol] ?? '', 10);
      if (!isNaN(seq)) stop.sequenceNumber = seq;
    }

    candidates.push(stop);
  }

  return { candidates, invalid };
}
