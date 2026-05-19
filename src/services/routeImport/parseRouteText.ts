import type { ImportedStop, InvalidRow } from './types';

// Lines that are clearly not addresses (headers, dividers, page numbers, dates)
const NOISE_RE = [
  /^page\s*\d+$/i,
  /^\d+\s*of\s*\d+$/i,
  /^route\s*(sheet|list|schedule|#\d+)?$/i,
  /^(address|stop\s*#?|customer|service|delivery|pickup|location|date|driver|route|sequence|seq|total)\s*:?\s*$/i,
  /^-{2,}$/,
  /^={2,}$/,
  /^\*{2,}$/,
  /^_{3,}$/,
  /^total\s*stops?\s*:/i,
  /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/,   // date-only line
];

// Leading sequence number: "1.", "1)", "2 ", "#3 ", "Stop 4:", etc.
const SEQ_PREFIX_RE = /^(?:stop\s*)?#?\s*\d+[.):\s]+/i;

function isNoise(line: string): boolean {
  return NOISE_RE.some((p) => p.test(line));
}

function looksLikeAddress(addr: string): boolean {
  if (addr.length < 8) return false;
  const words = addr.trim().split(/\s+/);
  return words.length >= 2;
}

export function parseRouteText(text: string): {
  candidates: ImportedStop[];
  invalid: InvalidRow[];
} {
  const lines = text.split(/\r?\n/);
  const candidates: ImportedStop[] = [];
  const invalid: InvalidRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? '';
    const trimmed = rawLine.trim();

    if (!trimmed) continue;

    if (isNoise(trimmed)) {
      invalid.push({ rawLine, lineNumber: i + 1, reason: 'Header / noise line' });
      continue;
    }

    const address = trimmed.replace(SEQ_PREFIX_RE, '').trim();

    if (!looksLikeAddress(address)) {
      invalid.push({ rawLine, lineNumber: i + 1, reason: 'Too short or not an address' });
      continue;
    }

    candidates.push({ address, rawLine, geocodeStatus: 'pending' });
  }

  return { candidates, invalid };
}
