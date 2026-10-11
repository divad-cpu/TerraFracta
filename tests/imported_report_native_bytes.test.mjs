import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDiagnosticReport } from '../src/diagnostic-report.ts';
import { readDiagnosticExport, DIAGNOSTIC_IMPORT_BYTES } from '../src/diagnostic-import.ts';
import { exportWeeklyRehearsal } from '../src/weekly-rehearsal-export.ts';
import { readWeeklyRehearsalReport, WEEKLY_REPORT_BYTE_LIMIT } from '../src/weekly-rehearsal-report.ts';

const diagnostic = buildDiagnosticReport({ events: [], unreadable: 0, filesObserved: 0,
  stable: true, locked: false }, new Date('2026-10-04T13:00:00.000Z'));
const assessment = { state: 'observed', observation: {
  schemaVersion: 1, evidenceKind: 'current_local_fictional_weekly_status', observedAt: '2026-10-03T14:36:03.626268+00:00',
  dueAt: '2026-09-28T06:00:00Z', windowKey: '2026-W40', graceMinutes: 60, state: 'attention', reason: 'run_not_completed',
  coverage: 'unknown', totalReceipts: 8, unreadableReceipts: 0, pendingReceipts: 0, realScheduleEnabled: false,
  trustedRunLedger: false, sourceRequests: 0, publicationEnabled: false, alertsSent: 0,
} };
const weekly = JSON.parse(exportWeeklyRehearsal(assessment).body);
const encode = x => new TextEncoder().encode(x);
for (const config of [
  { name: 'diagnostic', read: readDiagnosticExport, cap: DIAGNOSTIC_IMPORT_BYTES, report: diagnostic },
  { name: 'weekly', read: readWeeklyRehearsalReport, cap: WEEKLY_REPORT_BYTE_LIMIT, report: weekly },
]) {
  const text = JSON.stringify(config.report);
  for (const mode of ['ordinary-buffer', 'shadowed-overflow', 'throwing-getter', 'shadowed-exact',
      'shadowed-large', 'invalid-then-valid-getter', 'valid-then-invalid-getter']) {
    test(`${config.name}: imported ArrayBuffer bytes preserve quota and historical report (${mode})`, () => {
      const bytes = encode(text + (mode === 'shadowed-overflow' || mode === 'shadowed-exact' ?
        ' '.repeat(config.cap + (mode === 'shadowed-overflow' ? 1 : 0) - text.length) : ''));
      const input = bytes.buffer;
      let propertyReads = 0;
      if (mode === 'shadowed-overflow') Object.defineProperty(input, 'byteLength', { value: text.length });
      if (mode === 'shadowed-exact') Object.defineProperty(input, 'byteLength', { value: 1 });
      if (mode === 'shadowed-large') Object.defineProperty(input, 'byteLength', { value: config.cap + 1 });
      if (mode === 'throwing-getter') Object.defineProperty(input, 'byteLength', { get() { propertyReads++; throw Error('PRIVATE_REPORT_PROPERTY'); } });
      if (mode === 'invalid-then-valid-getter' || mode === 'valid-then-invalid-getter') {
        if (mode === 'invalid-then-valid-getter') bytes[0] = 33;
        Object.defineProperty(input, 'byteLength', { get() {
          propertyReads++; bytes[0] = mode === 'invalid-then-valid-getter' ? 123 : 33; return text.length;
        } });
      }
      if (mode === 'invalid-then-valid-getter' || mode === 'shadowed-overflow') assert.throws(() => config.read(input));
      else assert.deepEqual(config.read(input), config.report);
      assert.equal(propertyReads, 0);
      if (config.name === 'weekly') assert.equal(config.report.historicalObservation, true);
    });
  }
}

for (const config of [
  { name: 'diagnostic', read: readDiagnosticExport, report: diagnostic },
  { name: 'weekly', read: readWeeklyRehearsalReport, report: weekly },
]) {
  for (const behavior of ['yield-valid-report', 'throw-private-canary']) {
    test(`${config.name}: counterfeit ArrayBuffer never dispatches an iterator (${behavior})`, () => {
      const fake = Object.create(ArrayBuffer.prototype);
      const bytes = encode(JSON.stringify(config.report));
      let iterators = 0;
      Object.defineProperty(fake, 'byteLength', { value: bytes.length });
      fake[Symbol.iterator] = function* () {
        iterators++;
        if (behavior === 'throw-private-canary') throw Error('PRIVATE_ITERATOR_NOT_OBSERVED');
        yield* bytes;
      };
      assert.throws(() => config.read(fake));
      assert.equal(iterators, 0);
    });
  }
}
