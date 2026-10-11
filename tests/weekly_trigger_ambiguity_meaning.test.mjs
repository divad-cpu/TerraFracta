import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { weeklyReportHarness } from './helpers/weekly_report_harness.mjs';
import { weeklyStatusHarness } from './helpers/weekly_status_harness.mjs';
import { parseWeeklyRehearsalStatus } from '../src/weekly-rehearsal-status.ts';
import { exportWeeklyRehearsal } from '../src/weekly-rehearsal-export.ts';
import { readWeeklyRehearsalReport } from '../src/weekly-rehearsal-report.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const python = process.env.TF_TEST_PYTHON ?? root + '.venv/bin/python';
assert.ok(existsSync(python), 'Use the existing project Python interpreter');
// Import the real classifier only. Invented records and a fixed clock never open
// an archive, invoke main(), start a job, fetch a source or connect to a service.
const fixtureProgram = `
import sys, json
from datetime import datetime, timezone
network_events = []
def audit(event, args):
    if event.startswith('socket.'):
        network_events.append(event)
        raise AssertionError('Pure classification attempted socket access')
sys.addaudithook(audit)
sys.path.insert(0, sys.argv[1])
from scripts.weekly_rehearsal_status import classify_inventory
def receipt(trigger, instant):
    return {'trigger': trigger, 'scope': 'fictional-country', 'executedAt': instant,
        'runState': 'completed', 'coveredSourceKeys': ['fictional-source'],
        'fixtureDueAt': '2026-10-05T06:00:00Z' if trigger == 'scheduled' else None}
older = '2026-10-05T06:10:00Z'
newer = '2026-10-05T06:40:00Z'
groups = {
    'older_manual': [receipt('manual', older), receipt('manual', older), receipt('scheduled', newer)],
    'older_scheduled': [receipt('scheduled', older), receipt('scheduled', older), receipt('manual', newer)],
    'global_tie': [receipt('scheduled', newer), receipt('scheduled', newer)],
    'unique': [receipt('manual', older), receipt('scheduled', newer)],
}
result = {}
for name, receipts in groups.items():
    inventory = {'schemaVersion': 1, 'readComplete': True, 'totalReceipts': len(receipts),
        'unreadableReceipts': 0, 'pendingReceipts': 0, 'receipts': receipts}
    result[name] = {'receipts': receipts, 'status': {'state': 'observed',
        'observation': classify_inventory(inventory, now=datetime(2026, 10, 5, 7, 30, tzinfo=timezone.utc))}}
print(json.dumps({'python': sys.version.split()[0], 'socketOperations': len(network_events), 'fixtures': result}))
`;
const classified = spawnSync(python, ['-I', '-B', '-c', fixtureProgram, root], {
  cwd: root, env: { PATH: '/usr/bin:/bin', TZ: 'UTC' }, encoding: 'utf8',
  timeout: 10000, maxBuffer: 65536,
});
assert.equal(classified.error, undefined);
assert.equal(classified.status, 0, classified.stderr);
const proof = JSON.parse(classified.stdout);
assert.equal(proof.socketOperations, 0);
const fixtures = proof.fixtures;
const turn = () => new Promise(resolve => setImmediate(resolve));

async function renderBoth(t, value) {
  let reads = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    reads++; assert.equal(url, '/api/dev/update-rehearsal/status'); assert.equal(options.method, 'GET');
    return Response.json(value);
  });
  const current = weeklyStatusHarness(), saved = weeklyReportHarness();
  current.mount(); saved.mount();
  try {
    current.button().onClick();
    const input = { files: [new File([exportWeeklyRehearsal(value).body], 'PRIVATE_TRIGGER_FILENAME')], value: 'PRIVATE_TRIGGER_FILENAME' };
    saved.input().onChange({ currentTarget: input }); assert.equal(input.value, '');
    await turn(); assert.equal(reads, 1);
    return { current: current.markup(), saved: saved.markup() };
  } finally { current.unmount(); saved.unmount(); }
}

for (const name of ['older_manual', 'older_scheduled']) {
  test(name + ': a newer unique overall receipt does not make per-trigger ambiguity a global-latest claim', async t => {
    const fixture = fixtures[name], value = parseWeeklyRehearsalStatus(fixture.status);
    const latest = fixture.receipts.map(x => x.executedAt).sort().at(-1);
    assert.equal(fixture.receipts.filter(x => x.executedAt === latest).length, 1);
    assert.equal(value.observation.reason, 'latest_receipt_ambiguous');
    assert.equal(value.observation.state, 'held'); assert.equal(value.observation.coverage, 'unknown');
    const html = await renderBoth(t, value);
    for (const body of Object.values(html)) {
      assert.ok(body.includes("At least one rehearsal trigger&#x27;s latest recorded execution time had more than one receipt. That outcome remained unclear."));
      assert.doesNotMatch(body, /The latest recorded execution time had more than one receipt/);
      assert.doesNotMatch(body, /PRIVATE_TRIGGER_FILENAME/);
    }
    assert.match(html.saved, /<code>latest_receipt_ambiguous<\/code>/);
    assert.match(html.saved, /dated claim, not an authenticated receipt or a current inspection/);
  });
}

test('a global tie keeps closed held values, exact report bytes and disabled authority fields', async t => {
  const value = parseWeeklyRehearsalStatus(fixtures.global_tie.status), output = exportWeeklyRehearsal(value);
  const raw = new TextEncoder().encode(output.body).buffer;
  const parsed = readWeeklyRehearsalReport(raw, raw.byteLength);
  assert.deepEqual(parsed.observation, value.observation);
  assert.equal(exportWeeklyRehearsal({ state: 'observed', observation: parsed.observation }).body, output.body);
  assert.equal(parsed.observation.reason, 'latest_receipt_ambiguous');
  assert.equal(parsed.observation.state, 'held'); assert.equal(parsed.observation.coverage, 'unknown');
  assert.equal(parsed.observation.realScheduleEnabled, false); assert.equal(parsed.observation.trustedRunLedger, false);
  assert.equal(parsed.observation.sourceRequests, 0); assert.equal(parsed.observation.publicationEnabled, false); assert.equal(parsed.observation.alertsSent, 0);
  const html = await renderBoth(t, value);
  assert.match(html.saved, /<code>latest_receipt_ambiguous<\/code>/); assert.match(html.saved, /Coverage: unknown/);
});

test('unique latest receipts retain the unchanged healthy explanation and recorded timing', async t => {
  const value = parseWeeklyRehearsalStatus(fixtures.unique.status);
  assert.equal(value.observation.reason, 'due_window_completed');
  assert.equal(value.observation.state, 'healthy'); assert.equal(value.observation.coverage, 'complete');
  for (const body of Object.values(await renderBoth(t, value))) {
    assert.match(body, /A complete weekly rehearsal was recorded within the example deadline/);
    assert.doesNotMatch(body, /more than one receipt|outcome remained unclear/);
    assert.ok(body.includes(value.observation.observedAt)); assert.ok(body.includes(value.observation.dueAt));
  }
});
