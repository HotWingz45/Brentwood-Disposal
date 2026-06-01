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

// Comparison-only normalization used for duplicate detection.
// Does NOT mutate the stop's address; pure transform on a string.
// Steps per PARSER_SCHEMA.md duplicate-detection rules:
//   1. lowercase
//   2. strip punctuation except digits and spaces
//   3. collapse whitespace
//   4. strip trailing ", brentwood, tn" default suffix appended by normalizeStops
export function normalizeAddressForCompare(address: string): string {
  return address
    .toLowerCase()
    .replace(/[^\w\d\s]/g, ' ')          // strip punctuation
    .replace(/\s+/g, ' ')                 // collapse whitespace
    .trim()
    .replace(/\s*brentwood\s+tn\s*$/, '') // strip default suffix
    .trim();
}
