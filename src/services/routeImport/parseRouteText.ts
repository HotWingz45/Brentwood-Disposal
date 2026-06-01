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
  /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i,
];

// Leading sequence number with explicit delimiter: "1.", "1)", "Stop 4:", "#3:"
// Requires . : ) after the number so bare house numbers ("123 Main") are never stripped.
const SEQ_PREFIX_RE = /^(?:stop\s*)?#?\s*\d+[.:)]\s*/i;

// Captures the numeric portion of SEQ_PREFIX_RE — used to lift an explicit
// sequence number into ImportedStop.sequenceNumber when present in source.
const SEQ_PREFIX_CAPTURE_RE = /^(?:stop\s*)?#?\s*(\d+)[.:)]\s*/i;

// Confidence-scoring signals (per PARSER_SCHEMA.md)
const US_STREET_RE = /\b\d+\s+\w+/;
const ZIP_RE = /\b\d{5}(?:-\d{4})?\b/;
const STATE_RE = /\b(?:TN|AL|KY|GA|MS|AR|MO|SC|NC|VA|FL|Tennessee)\b/i;

function scoreTextAddress(address: string, hasSourceSeq: boolean): number {
  let s = 0.5;
  if (US_STREET_RE.test(address)) s += 0.2;
  if (ZIP_RE.test(address)) s += 0.1;
  if (STATE_RE.test(address)) s += 0.1;
  if (hasSourceSeq) s += 0.05;
  // Single-word or very short address (post-strip) is suspect
  if (address.trim().split(/\s+/).length < 2) s -= 0.3;
  return Math.max(0, Math.min(1, s));
}

// Full set: every word that can appear as a standalone suffix line in a PDF
// Used to decide whether a single-word line should be merged into the previous candidate.
const MERGEABLE_SUFFIX_WORDS = new Set([
  'alley', 'aly',
  'avenue', 'ave',
  'bend',
  'boulevard', 'blvd',
  'branch', 'br',
  'bypass',
  'circle', 'cir',
  'close',
  'commons',
  'court', 'ct',
  'cove', 'cv',
  'creek',
  'crossing', 'xing',
  'cutoff',
  'drive', 'dr',
  'esplanade',
  'estates',
  'expressway', 'expy',
  'extension', 'ext',
  'freeway', 'fwy',
  'glen',
  'grove', 'grv',
  'heights', 'hts',
  'highway', 'hwy',
  'hill',
  'hills',
  'hollow', 'holw',
  'junction', 'jct',
  'key',
  'lake', 'lk',
  'landing', 'lndg',
  'lane', 'ln',
  'loop',
  'mall',
  'manor', 'mnr',
  'meadows', 'mdws',
  'mill',
  'mills',
  'motorway',
  'oval',
  'park', 'pk',
  'parkway', 'pkwy',
  'pass',
  'path',
  'pike',
  'place', 'pl',
  'plain',
  'plains',
  'plaza', 'plz',
  'point', 'pt',
  'port',
  'prairie',
  'ranch',
  'ridge', 'rdg',
  'road', 'rd',
  'row',
  'run',
  'shoals',
  'shore',
  'shores',
  'square', 'sq',
  'station', 'sta',
  'street', 'st',
  'summit', 'smt',
  'terrace', 'ter',
  'trace', 'trce',
  'trail', 'trl',
  'tunnel',
  'turnpike', 'tpke',
  'valley', 'vly',
  'view',
  'views',
  'village', 'vlg',
  'vista', 'vis',
  'walk',
  'way',
  'well',
  'wells',
]);

// Restricted set: unambiguous suffixes that clearly terminate an address.
// Words like "Ridge", "Hill", "Creek", "Glen" are excluded because they commonly
// appear as part of a street name (e.g. "Blue Ridge Pass") and would falsely
// block a following suffix from being merged.
const CLEAR_TERMINAL_SUFFIXES = new Set([
  'avenue', 'ave',
  'boulevard', 'blvd',
  'bypass',
  'circle', 'cir',
  'close',
  'court', 'ct',
  'crossing', 'xing',
  'drive', 'dr',
  'expressway', 'expy',
  'extension', 'ext',
  'freeway', 'fwy',
  'highway', 'hwy',
  'lane', 'ln',
  'loop',
  'motorway',
  'parkway', 'pkwy',
  'pass',
  'path',
  'pike',
  'place', 'pl',
  'plaza', 'plz',
  'road', 'rd',
  'row',
  'run',
  'square', 'sq',
  'street', 'st',
  'terrace', 'ter',
  'trace', 'trce',
  'trail', 'trl',
  'turnpike', 'tpke',
  'walk',
  'way',
]);

function isNoise(line: string): boolean {
  return NOISE_RE.some((p) => p.test(line));
}

function isMergeableSuffix(word: string): boolean {
  return MERGEABLE_SUFFIX_WORDS.has(word.toLowerCase());
}

// Returns true only for unambiguous terminal suffixes — prevents false-positive
// blocking when a word like "Ridge" appears mid-name (e.g. "Blue Ridge Pass").
function hasClearTerminalSuffix(addr: string): boolean {
  const lastWord = addr.trim().split(/\s+/).pop() ?? '';
  return CLEAR_TERMINAL_SUFFIXES.has(lastWord.toLowerCase());
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

  // Batch prefix for stop_id — unique per parser invocation
  const batchId = Date.now().toString(36);
  let assignSeq = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? '';
    const trimmed = rawLine.trim();

    if (!trimmed) continue;

    if (isNoise(trimmed)) {
      invalid.push({ rawLine, lineNumber: i + 1, reason: 'Header / noise line' });
      continue;
    }

    // Lift explicit sequence number from source if present (e.g. "5. 123 Main St")
    const seqMatch = trimmed.match(SEQ_PREFIX_CAPTURE_RE);
    const sourceSeq = seqMatch?.[1] ? parseInt(seqMatch[1], 10) : undefined;

    const address = trimmed.replace(SEQ_PREFIX_RE, '').trim();

    // Single suffix word: try to append to the previous candidate if it lacks a clear terminal suffix
    if (address.split(/\s+/).length === 1 && isMergeableSuffix(address)) {
      const last = candidates[candidates.length - 1];
      if (last && !hasClearTerminalSuffix(last.address)) {
        last.address = `${last.address} ${address}`;
        last.rawLine = `${last.rawLine.trim()} ${rawLine.trim()}`;
        // Re-score after merge — append may have completed the street suffix
        last.confidence_score = scoreTextAddress(last.address, last.sequenceNumber !== undefined);
      }
      // Whether merged or discarded, never treat it as its own candidate
      invalid.push({ rawLine, lineNumber: i + 1, reason: 'Standalone suffix — merged or discarded' });
      continue;
    }

    if (!looksLikeAddress(address)) {
      invalid.push({ rawLine, lineNumber: i + 1, reason: 'Too short or not an address' });
      continue;
    }

    assignSeq++;
    candidates.push({
      address,
      rawLine,
      geocodeStatus: 'pending',
      stop_id: `s-${batchId}-${assignSeq}`,
      sequenceNumber: sourceSeq,
      confidence_score: scoreTextAddress(address, sourceSeq !== undefined),
    });
  }

  return { candidates, invalid };
}
