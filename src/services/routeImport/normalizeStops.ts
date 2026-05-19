import type { ImportedStop } from './types';

// Indicates address already has a state / zip — don't append city
const STATE_RE = /\b(?:TN|AL|KY|GA|MS|AR|MO|SC|NC|VA|FL|Tennessee|Alabama|Kentucky|Georgia)\b/i;
const ZIP_RE = /\b\d{5}(?:-\d{4})?\b/;

export function normalizeStops(stops: ImportedStop[]): ImportedStop[] {
  return stops.map((s) => {
    let addr = s.address
      .trim()
      .replace(/\s{2,}/g, ' ')              // collapse runs of whitespace
      .replace(/^[,;.\-\s]+|[,;.\-\s]+$/g, '') // strip leading/trailing punctuation
      .trim();

    if (!STATE_RE.test(addr) && !ZIP_RE.test(addr)) {
      addr = `${addr}, Brentwood, TN`;
    }

    return { ...s, address: addr };
  });
}
