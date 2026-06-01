/**
 * Phase 5 parser test harness.
 *
 * Runs the existing parse → normalize → validate pipeline against a static set
 * of fixtures. Does NOT geocode, does NOT touch persistence, does NOT need the
 * app, simulator, or Google API key. Exits non-zero if any fixture fails.
 *
 * Invoke via `npm run test:parser` from the repo root.
 */

import { parseRouteText } from '../../src/services/routeImport/parseRouteText';
import { parseTabularStops } from '../../src/services/routeImport/parseTabularStops';
import { parseBrentwoodTable } from '../../src/services/routeImport/parseBrentwoodTable';
import { normalizeStops } from '../../src/services/routeImport/normalizeStops';
import { validateStops } from '../../src/services/routeImport/validateStops';
import type {
  ImportedStop,
  InvalidRow,
} from '../../src/services/routeImport/types';

import { fixtures } from './fixtures';
import type { Fixture, FixtureExpect } from './types';

interface RunResult {
  candidates: ImportedStop[];
  preInvalid: InvalidRow[];
  valid: ImportedStop[];
  needsReview: ImportedStop[];
  invalid: InvalidRow[];
}

function runPipeline(f: Fixture): RunResult {
  let candidates: ImportedStop[];
  let preInvalid: InvalidRow[];

  if (f.kind === 'csv') {
    const r = parseTabularStops(f.input);
    candidates = r.candidates;
    preInvalid = r.invalid;
  } else if (f.kind === 'pdf') {
    const r = parseBrentwoodTable(f.input);
    candidates = r.candidates;
    preInvalid = r.invalid;
  } else {
    const r = parseRouteText(f.input);
    candidates = r.candidates;
    preInvalid = r.invalid;
  }

  const normalized = normalizeStops(candidates);
  const { valid, needsReview, invalid } = validateStops(normalized, preInvalid);

  return { candidates, preInvalid, valid, needsReview, invalid };
}

function checkExpectations(
  result: RunResult,
  expect: FixtureExpect,
): { passed: boolean; failures: string[]; passes: string[] } {
  const failures: string[] = [];
  const passes: string[] = [];

  const v = result.valid.length;
  const nr = result.needsReview.length;
  const inv = result.invalid.length;

  const numericChecks: Array<{
    label: string;
    actual: number;
    op: 'min' | 'max';
    bound: number | undefined;
  }> = [
    { label: 'valid',        actual: v,   op: 'min', bound: expect.minValid },
    { label: 'valid',        actual: v,   op: 'max', bound: expect.maxValid },
    { label: 'needs_review', actual: nr,  op: 'min', bound: expect.minNeedsReview },
    { label: 'needs_review', actual: nr,  op: 'max', bound: expect.maxNeedsReview },
    { label: 'invalid',      actual: inv, op: 'min', bound: expect.minInvalid },
    { label: 'invalid',      actual: inv, op: 'max', bound: expect.maxInvalid },
  ];

  for (const c of numericChecks) {
    if (c.bound === undefined) continue;
    if (c.op === 'min') {
      if (c.actual >= c.bound) passes.push(`${c.label} >= ${c.bound} (got ${c.actual})`);
      else failures.push(`${c.label} ${c.actual} < expected min ${c.bound}`);
    } else {
      if (c.actual <= c.bound) passes.push(`${c.label} <= ${c.bound} (got ${c.actual})`);
      else failures.push(`${c.label} ${c.actual} > expected max ${c.bound}`);
    }
  }

  if (expect.addressContains) {
    const haystacks = [...result.valid, ...result.needsReview].map((s) =>
      s.address.toLowerCase(),
    );
    for (const needle of expect.addressContains) {
      const n = needle.toLowerCase();
      const found = haystacks.some((a) => a.includes(n));
      if (found) passes.push(`address contains "${needle}"`);
      else failures.push(`expected an address containing "${needle}" — none found`);
    }
  }

  if (expect.noValidContains) {
    const validAddrs = result.valid.map((s) => s.address.toLowerCase());
    for (const needle of expect.noValidContains) {
      const n = needle.toLowerCase();
      const found = validAddrs.some((a) => a.includes(n));
      if (!found) passes.push(`no valid address contains "${needle}"`);
      else failures.push(`unexpected valid address containing "${needle}"`);
    }
  }

  if (expect.fieldsContain) {
    const all = [...result.valid, ...result.needsReview];
    const checks: Array<{
      key: 'customer_name' | 'access_code' | 'notes' | 'pickup_type';
      values: string[] | undefined;
    }> = [
      { key: 'customer_name', values: expect.fieldsContain.customer_name },
      { key: 'access_code',   values: expect.fieldsContain.access_code },
      { key: 'notes',         values: expect.fieldsContain.notes },
      { key: 'pickup_type',   values: expect.fieldsContain.pickup_type },
    ];
    for (const c of checks) {
      if (!c.values) continue;
      for (const needle of c.values) {
        const n = needle.toLowerCase();
        const found = all.some((s) => {
          const val = s[c.key];
          return typeof val === 'string' && val.toLowerCase().includes(n);
        });
        if (found) passes.push(`${c.key} contains "${needle}"`);
        else failures.push(`expected a ${c.key} containing "${needle}" — none found`);
      }
    }
  }

  return { passed: failures.length === 0, failures, passes };
}

function formatStop(s: ImportedStop, maxAddr: number): string {
  const status = (s.validation_status ?? 'unknown').padEnd(12);
  const conf =
    typeof s.confidence_score === 'number' ? s.confidence_score.toFixed(2) : '—';
  const addr =
    s.address.length > maxAddr
      ? s.address.slice(0, maxAddr - 1) + '…'
      : s.address;
  const extras: string[] = [];
  if (s.customer_name) extras.push(`name: ${s.customer_name}`);
  if (s.pickup_type) extras.push(`pickup: ${s.pickup_type}`);
  if (s.access_code) extras.push(`code: ${s.access_code}`);
  if (s.notes) extras.push(`notes: ${s.notes}`);
  const tail = extras.length > 0 ? `  (${extras.join(', ')})` : '';
  return `    [${status}] conf=${conf}  "${addr}"${tail}`;
}

function main(): void {
  const sep = '═'.repeat(72);
  let totalPassed = 0;
  let totalFailed = 0;

  for (const f of fixtures) {
    console.log('');
    console.log(sep);
    console.log(`Fixture: ${f.name}`);
    console.log(sep);
    console.log(`  Description: ${f.description}`);
    const lineCount = f.input.split('\n').length;
    console.log(`  Input:       ${f.kind} | ${lineCount} lines | ${f.input.length} chars`);
    console.log('');

    let result: RunResult;
    try {
      result = runPipeline(f);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  PIPELINE_THREW: ${msg}`);
      console.log(`  RESULT: FAIL`);
      totalFailed++;
      continue;
    }

    console.log(`  Parse stage:`);
    console.log(`    candidates:        ${result.candidates.length}`);
    console.log(`    pre-rejected:      ${result.preInvalid.length}`);
    console.log('');
    console.log(`  Validation stage:`);
    console.log(`    valid:             ${result.valid.length}`);
    console.log(`    needs_review:      ${result.needsReview.length}`);
    console.log(`    invalid:           ${result.invalid.length}`);
    console.log('');

    if (result.valid.length + result.needsReview.length > 0) {
      console.log(`  Sample stops:`);
      const sample = [...result.valid, ...result.needsReview].slice(0, 6);
      for (const s of sample) console.log(formatStop(s, 60));
      console.log('');
    }

    if (result.invalid.length > 0) {
      console.log(`  Invalid rows (first 3):`);
      for (const i of result.invalid.slice(0, 3)) {
        const line = (i.rawLine || '(empty)').slice(0, 50);
        console.log(`    "${line}" — ${i.reason}`);
      }
      console.log('');
    }

    const check = checkExpectations(result, f.expect);
    console.log(`  Expectations:`);
    for (const p of check.passes) console.log(`    ✓ ${p}`);
    for (const fail of check.failures) console.log(`    ✗ ${fail}`);
    console.log('');
    console.log(`  RESULT: ${check.passed ? 'PASS' : 'FAIL'}`);

    if (check.passed) totalPassed++;
    else totalFailed++;
  }

  console.log('');
  console.log(sep);
  console.log(
    `Summary: ${fixtures.length} fixtures — ${totalPassed} passed, ${totalFailed} failed`,
  );
  console.log(sep);
  console.log('');

  process.exit(totalFailed > 0 ? 1 : 0);
}

main();
