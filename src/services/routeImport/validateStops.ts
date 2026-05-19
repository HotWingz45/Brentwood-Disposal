import type { ImportedStop, InvalidRow } from './types';

const ADDRESS_RE = /\d|[A-Za-z]{2,}/;

export function validateStops(
  candidates: ImportedStop[],
  prior: InvalidRow[]
): { valid: ImportedStop[]; invalid: InvalidRow[] } {
  const valid: ImportedStop[] = [];
  const invalid: InvalidRow[] = [...prior];

  for (let i = 0; i < candidates.length; i++) {
    const stop = candidates[i]!;
    const addr = stop.address.trim();

    if (!addr) {
      invalid.push({ rawLine: stop.rawLine, lineNumber: i + 1, reason: 'Empty address after normalization' });
      continue;
    }
    if (addr.length < 8) {
      invalid.push({ rawLine: stop.rawLine, lineNumber: i + 1, reason: 'Address too short' });
      continue;
    }
    if (!ADDRESS_RE.test(addr)) {
      invalid.push({ rawLine: stop.rawLine, lineNumber: i + 1, reason: 'Does not look like an address' });
      continue;
    }

    valid.push(stop);
  }

  return { valid, invalid };
}
