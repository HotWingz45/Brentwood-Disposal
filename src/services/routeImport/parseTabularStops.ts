import Papa from 'papaparse';
import type { ImportedStop, InvalidRow } from './types';

const ADDRESS_HEADERS = ['address', 'addr', 'street', 'location', 'stop address', 'service address', 'delivery', 'pickup', 'drop off'];
const LAT_HEADERS = ['lat', 'latitude', 'y'];
const LNG_HEADERS = ['lng', 'lon', 'long', 'longitude', 'x'];
const SEQ_HEADERS = ['stop', 'stop#', 'stop #', 'seq', 'sequence', 'order', '#', 'num', 'number', 'route stop'];

// Phase 2 additions — only used when an explicit header row is detected
const NAME_HEADERS = ['name', 'customer', 'customer name', 'last name', 'lastname', 'client', 'account'];
const PICKUP_TYPE_HEADERS = ['pickup type', 'service type', 'service', 'type', 'category', 'pickup'];
const NOTES_HEADERS = ['notes', 'note', 'comments', 'comment', 'instructions', 'remarks'];
const ACCESS_CODE_HEADERS = ['access code', 'access', 'gate code', 'gate', 'code', 'keypad'];

const ALL_KNOWN = new Set([
  ...ADDRESS_HEADERS,
  ...LAT_HEADERS,
  ...LNG_HEADERS,
  ...SEQ_HEADERS,
  ...NAME_HEADERS,
  ...PICKUP_TYPE_HEADERS,
  ...NOTES_HEADERS,
  ...ACCESS_CODE_HEADERS,
]);

const US_STREET_RE = /\b\d+\s+\w+/;
const ZIP_RE = /\b\d{5}(?:-\d{4})?\b/;
const STATE_RE = /\b(?:TN|AL|KY|GA|MS|AR|MO|SC|NC|VA|FL|Tennessee)\b/i;

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

function scoreTabular(
  address: string,
  opts: { headerDetected: boolean; hasSourceSeq: boolean; hasCustomerName: boolean; preResolved: boolean },
): number {
  let s = 0.5;
  if (opts.headerDetected) s += 0.15;
  if (opts.preResolved) s += 0.15;        // lat/lng already in source
  if (US_STREET_RE.test(address)) s += 0.2;
  if (ZIP_RE.test(address)) s += 0.1;
  if (STATE_RE.test(address)) s += 0.1;
  if (opts.hasSourceSeq) s += 0.05;
  if (opts.hasCustomerName) s += 0.05;
  return Math.max(0, Math.min(1, s));
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
  let nameCol = -1;
  let pickupCol = -1;
  let notesCol = -1;
  let accessCol = -1;

  const firstRow = rows[0] ?? [];
  const headerDetected = isHeaderRow(firstRow);
  if (headerDetected) {
    startRow = 1;
    addrCol = findCol(firstRow, ADDRESS_HEADERS);
    latCol = findCol(firstRow, LAT_HEADERS);
    lngCol = findCol(firstRow, LNG_HEADERS);
    seqCol = findCol(firstRow, SEQ_HEADERS);
    nameCol = findCol(firstRow, NAME_HEADERS);
    pickupCol = findCol(firstRow, PICKUP_TYPE_HEADERS);
    notesCol = findCol(firstRow, NOTES_HEADERS);
    accessCol = findCol(firstRow, ACCESS_CODE_HEADERS);
    // Don't let the same column be both address and pickup_type — address wins
    if (pickupCol !== -1 && pickupCol === addrCol) pickupCol = -1;
  }

  if (addrCol === -1) addrCol = 0;

  const batchId = Date.now().toString(36);
  let assignSeq = 0;

  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const rawLine = row.join(',');
    const rawAddr = row[addrCol]?.trim() ?? '';

    if (!rawAddr) {
      invalid.push({ rawLine, lineNumber: i + 1, reason: 'Empty address cell' });
      continue;
    }

    assignSeq++;
    const stop: ImportedStop = {
      address: rawAddr,
      rawLine,
      geocodeStatus: 'pending',
      stop_id: `s-${batchId}-${assignSeq}`,
    };

    let preResolved = false;
    if (latCol !== -1 && lngCol !== -1) {
      const lat = parseFloat(row[latCol] ?? '');
      const lng = parseFloat(row[lngCol] ?? '');
      if (!isNaN(lat) && !isNaN(lng)) {
        stop.latitude = lat;
        stop.longitude = lng;
        stop.geocodeStatus = 'resolved';
        preResolved = true;
      }
    }

    let hasSourceSeq = false;
    if (seqCol !== -1) {
      const seq = parseInt(row[seqCol] ?? '', 10);
      if (!isNaN(seq)) {
        stop.sequenceNumber = seq;
        hasSourceSeq = true;
      }
    }

    let hasCustomerName = false;
    if (nameCol !== -1) {
      const name = row[nameCol]?.trim();
      if (name) {
        stop.customer_name = name;
        hasCustomerName = true;
      }
    }
    if (pickupCol !== -1) {
      const p = row[pickupCol]?.trim();
      if (p) stop.pickup_type = p;
    }
    if (notesCol !== -1) {
      const n = row[notesCol]?.trim();
      if (n) stop.notes = n;
    }
    if (accessCol !== -1) {
      const c = row[accessCol]?.trim();
      if (c) stop.access_code = c;
    }

    stop.confidence_score = scoreTabular(rawAddr, {
      headerDetected,
      hasSourceSeq,
      hasCustomerName,
      preResolved,
    });

    candidates.push(stop);
  }

  return { candidates, invalid };
}
