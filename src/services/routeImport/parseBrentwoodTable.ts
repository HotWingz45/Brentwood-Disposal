/**
 * Table parser for the Brentwood Disposal "Friday Groups" PDF format.
 *
 * The PDF renders a 5-column table (Last Name | Address | Pick-Up | Recycling | Access Code)
 * as a stream of lines that follow this per-row pattern:
 *
 *   [Name] [HouseNum] [StreetStart]     <- name and address start may share a line
 *   [StreetContinuation…]               <- address may wrap across 1-2 extra lines
 *   (Backdoor|Street) No [AccessCode]   <- pickup + recycling + optional inline code
 *   [AccessCodeContinuation…]           <- access code may also wrap
 *
 * Special cases handled:
 *   - Multi-word names ("Dream Home Trust") where the name wraps before the house number
 *   - House number at end of line ("Soni 1613") with street on the next line
 *   - Compound single-line rows ("HollandA 1 Portrush Court Street No DL")
 *   - Multi-line access codes (Massey's gate instructions span 4 lines)
 *   - ALL_CAPS access code labels (GATE CODE, NEW CUSTOMER, NO CRUSH, DL)
 */

import type { ImportedStop, InvalidRow } from './types';

const US_STREET_RE = /\b\d+\s+\w+/;

function scoreBrentwoodRow(address: string, hasName: boolean): number {
  // PDF table is a structured source (+0.15). Start at 0.5.
  let s = 0.5 + 0.15;
  if (US_STREET_RE.test(address)) s += 0.2;
  if (hasName) s += 0.05;
  // Sequence number is always assigned (parse order), so always +0.05
  s += 0.05;
  // Penalty if pdf-parse produced a suspiciously short or digit-less address
  if (!/\d/.test(address)) s -= 0.2;
  return Math.max(0, Math.min(1, s));
}

// ── Internal buffer for one in-progress stop ──────────────────────

interface StopBuffer {
  nameWords: string[];
  addrWords: string[];
  pickup: string;
  inlineAccessCode: string;
  accessCodeWords: string[];
  hasAddress: boolean;
}

function emptyBuffer(): StopBuffer {
  return {
    nameWords: [],
    addrWords: [],
    pickup: '',
    inlineAccessCode: '',
    accessCodeWords: [],
    hasAddress: false,
  };
}

// ── Address-start detection ───────────────────────────────────────

interface AddrStart {
  namePart: string;
  houseNum: string;
  streetPart: string;
}

/**
 * Determines whether a line begins (or contains) a house number in address context.
 *
 * Two patterns:
 *   1. Number followed by a capital-letter street word on the same line
 *      e.g. "Digiacobbe 602 Firefox"  → { namePart:"Digiacobbe", houseNum:"602", streetPart:"Firefox" }
 *   2. Number at the very end of the line (street continues on next line)
 *      e.g. "Soni 1613"               → { namePart:"Soni", houseNum:"1613", streetPart:"" }
 *
 * Access-code numbers are excluded: they are always followed by lowercase words
 * ("2378 then press…") or appear mid-sentence, so neither pattern fires for them.
 */
function detectAddressStart(line: string): AddrStart | null {
  // Pattern 1: house number + capitalized street word on same line
  const m1 = line.match(/^(.*?)\b(\d{1,5})\s+([A-Z][a-zA-Z'\-].*)/);
  if (m1) {
    return {
      namePart: (m1[1] ?? '').trimEnd(),
      houseNum: m1[2] ?? '',
      streetPart: (m1[3] ?? '').trim(),
    };
  }
  // Pattern 2: number at end of line (preceded by at least one name word)
  const m2 = line.match(/^(.+?)\s+(\d{1,5})\s*$/);
  if (m2) {
    return {
      namePart: (m2[1] ?? '').trim(),
      houseNum: m2[2] ?? '',
      streetPart: '',
    };
  }
  return null;
}

// ── Line classification helpers ───────────────────────────────────

// A "name word" line starts with a capital letter followed by at least one
// lowercase letter — distinguishes title-case names from ALL_CAPS access-code labels.
function looksLikeNameStart(line: string): boolean {
  if (!line || !/^[A-Z][a-z]/.test(line)) return false;
  if (/^(Backdoor|Street)\b/i.test(line)) return false;
  return true;
}

// ── Buffer → stop ─────────────────────────────────────────────────

function flushBuffer(
  buf: StopBuffer,
  sequenceNumber: number,
  stopId: string,
): ImportedStop | null {
  const addrRaw = buf.addrWords.join(' ').trim();
  if (!addrRaw || !buf.pickup) return null;

  const name = buf.nameWords.join(' ').trim();
  const accessCode = [buf.inlineAccessCode, ...buf.accessCodeWords]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ');

  const instructions = [
    buf.pickup !== 'Street' ? buf.pickup : undefined,
    accessCode || undefined,
  ]
    .filter(Boolean)
    .join(' — ');

  return {
    address: addrRaw,
    rawLine: [name, addrRaw, buf.pickup, 'No', accessCode].filter(Boolean).join(' | '),
    geocodeStatus: 'pending',
    sequenceNumber,
    stop_id: stopId,
    confidence_score: scoreBrentwoodRow(addrRaw, Boolean(name)),
    ...(name ? { customer_name: name } : {}),
    pickup_type: buf.pickup,
    ...(accessCode ? { access_code: accessCode } : {}),
    // importMetadata preserved for backward compatibility with any debug consumers
    importMetadata: {
      name,
      pickup: buf.pickup,
      recycling: 'No',
      ...(accessCode ? { accessCode } : {}),
      ...(instructions ? { instructions } : {}),
    },
  };
}

// ── Skip lines ────────────────────────────────────────────────────

const SKIP_RE = /^(Friday\s*$|Last\s+Name\s+Address)/i;

// ── Main parser ───────────────────────────────────────────────────

export function parseBrentwoodTable(text: string): {
  candidates: ImportedStop[];
  invalid: InvalidRow[];
} {
  const rawLines = text.split('\n');
  const candidates: ImportedStop[] = [];
  const invalid: InvalidRow[] = [];

  type State = 'after_pickup' | 'collecting';
  let state: State = 'after_pickup';
  let buf = emptyBuffer();
  let stopSeq = 1;
  const batchId = Date.now().toString(36);

  function commitStop() {
    const stop = flushBuffer(buf, stopSeq, `s-${batchId}-${stopSeq}`);
    if (stop) {
      candidates.push(stop);
      stopSeq++;
    }
    buf = emptyBuffer();
  }

  function applyAddressStart(a: AddrStart) {
    if (a.namePart) buf.nameWords.push(a.namePart);
    buf.addrWords.push(a.houseNum + (a.streetPart ? ' ' + a.streetPart : ''));
    buf.hasAddress = true;
  }

  for (let li = 0; li < rawLines.length; li++) {
    const raw = rawLines[li] ?? '';
    const line = raw.trim();
    if (!line || SKIP_RE.test(line)) continue;

    // ── Pickup line detection (works anywhere in line for compound rows) ──
    // e.g. "HollandA 1 Portrush Court Street No DL" is compound
    const pm = line.match(/^(.*?)\b(Backdoor|Street)\s+No\s*(.*)/i);
    if (pm) {
      const beforePickup = (pm[1] ?? '').trim();
      const pickup = pm[2] ?? '';
      const afterNo = (pm[3] ?? '').trim();

      if (beforePickup) {
        // Compound row: process the leading content as name/address
        if (state === 'collecting') {
          if (buf.hasAddress) {
            // Unexpected extra text before pickup in an address-collecting state
            buf.addrWords.push(beforePickup);
          } else {
            const a = detectAddressStart(beforePickup);
            if (a) {
              applyAddressStart(a);
            } else {
              buf.nameWords.push(beforePickup);
            }
          }
        } else {
          // AFTER_PICKUP: compound row that starts a brand-new stop
          const a = detectAddressStart(beforePickup);
          if (a) {
            commitStop();
            applyAddressStart(a);
          } else if (looksLikeNameStart(beforePickup)) {
            commitStop();
            buf.nameWords.push(beforePickup);
          }
        }
      }

      buf.pickup = pickup;
      buf.inlineAccessCode = afterNo;
      state = 'after_pickup';
      continue;
    }

    // ── AFTER_PICKUP: access code continuation OR start of next stop ──
    if (state === 'after_pickup') {
      const a = detectAddressStart(line);
      if (a) {
        // New stop starting directly with name+address
        commitStop();
        applyAddressStart(a);
        state = 'collecting';
        continue;
      }
      if (looksLikeNameStart(line)) {
        // New stop starting with a name (address on a later line)
        commitStop();
        buf.nameWords.push(line);
        state = 'collecting';
        continue;
      }
      // Anything else (lowercase, digit, all-caps) is access code continuation
      buf.accessCodeWords.push(line);
      continue;
    }

    // ── COLLECTING: gathering name words then address words ──────────
    if (!buf.hasAddress) {
      const a = detectAddressStart(line);
      if (a) {
        applyAddressStart(a);
      } else {
        // Another name word before the house number (e.g. "Trust" in "Dream Home Trust")
        buf.nameWords.push(line);
      }
    } else {
      // Address already started — this is a street-name continuation line
      buf.addrWords.push(line);
    }
  }

  // Commit whatever remains (last stop in the PDF)
  commitStop();

  return { candidates, invalid };
}
