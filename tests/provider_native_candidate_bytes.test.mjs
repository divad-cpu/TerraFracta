import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import test from 'node:test';
import { createPublicIssueReader, PUBLIC_CANDIDATE_BYTES } from '../src/server/public-issue-reader.ts';
import { createOperatorAuditReader, OPERATOR_AUDIT_BYTES } from '../src/server/operator-audit-reader.ts';
import { createOperatorAuditChoicesReader } from '../src/server/operator-audit-choices-reader.ts';
import { createHeldDecisionsReader } from '../src/server/operator-held-decisions-reader.ts';
import { createProposalReader } from '../src/server/operator-proposal-reader.ts';

const id = '11111111-1111-4111-8111-111111111111';
const route = { jurisdictionSlug: 'invented-country', issueSlug: 'invented-issue' };
const auditScope = { runId: id, issueId: id, cursor: null };
const heldScope = { runId: id, cursor: null };
const proposalScope = { runId: id, decisionId: id };
const encode = value => new TextEncoder().encode(value);
const choiceCursor = { createdAt: '2026-10-05T09:00:00.000001Z', runId: id };
const configs = [
  { name: 'public', make: createPublicIssueReader, input: route, bytesLimit: PUBLIC_CANDIDATE_BYTES,
    json: 'null', accepted: { status: 404, cacheControl: 'no-store' }, refused: { status: 503, cacheControl: 'no-store' }, code: 'public_issue_read' },
  { name: 'audit', make: createOperatorAuditReader, input: auditScope, bytesLimit: OPERATOR_AUDIT_BYTES,
    json: JSON.stringify({ schemaVersion: 1, status: 'not_found', requested: auditScope }), accepted: { kind: 'not_found' } },
  { name: 'choices', make: createOperatorAuditChoicesReader, input: null, cursor: choiceCursor, bytesLimit: OPERATOR_AUDIT_BYTES,
    json: JSON.stringify({ schemaVersion: 2, status: 'changed', requestedRunId: null, requestedCursor: choiceCursor }), accepted: { kind: 'changed' } },
  { name: 'held', make: createHeldDecisionsReader, input: heldScope, bytesLimit: OPERATOR_AUDIT_BYTES,
    json: JSON.stringify({ schemaVersion: 1, status: 'not_found', requested: heldScope }), accepted: { kind: 'not_found' } },
  { name: 'proposal', make: createProposalReader, input: proposalScope, bytesLimit: OPERATOR_AUDIT_BYTES,
    json: JSON.stringify({ schemaVersion: 1, status: 'not_found', requested: proposalScope }), accepted: { kind: 'not_found' } },
];
for (const config of configs) {
  for (const mode of ['shadowed-overflow', 'shadowed-valid', 'shadowed-exact', 'shadowed-large',
      'invalid-then-valid-getter', 'valid-then-invalid-getter', 'offset-buffer']) {
    test(`${config.name}: native provider candidate budget and ownership (${mode})`, async () => {
      const padded = mode === 'shadowed-overflow' || mode === 'shadowed-exact';
      let value = encode(config.json + (padded ? ' '.repeat(config.bytesLimit + (mode === 'shadowed-overflow' ? 1 : 0) - config.json.length) : ''));
      const nativeLength = value.length;
      if (mode === 'shadowed-overflow') Object.defineProperty(value, 'byteLength', { value: config.json.length });
      if (mode === 'shadowed-exact') Object.defineProperty(value, 'byteLength', { value: 1 });
      if (mode === 'shadowed-large') Object.defineProperty(value, 'byteLength', { value: config.bytesLimit + 1 });
      let propertyReads = 0;
      if (mode === 'shadowed-valid') Object.defineProperty(value, 'byteLength', { get() { propertyReads++; throw Error('PRIVATE_PROVIDER_GETTER'); } });
      if (mode.endsWith('-getter')) {
        const validFirst = value[0], invalidFirst = '!'.charCodeAt(0);
        value[0] = mode === 'invalid-then-valid-getter' ? invalidFirst : validFirst;
        Object.defineProperty(value, 'byteLength', { get() {
          propertyReads++; value[0] = mode === 'invalid-then-valid-getter' ? validFirst : invalidFirst; return nativeLength;
        } });
      }
      if (mode === 'offset-buffer') value = Buffer.from('prefix' + config.json + 'suffix').subarray(6, 6 + config.json.length);
      const diagnostics = [], caller = new AbortController();
      let calls = 0, child;
      const read = config.make(async (_input, signal) => { calls++; child = signal; return value; }, () => 0,
        async (...args) => { diagnostics.push(args); return 'saved'; });
      const result = await read(config.input, caller.signal, config.cursor ?? null);
      const refused = ['shadowed-overflow', 'invalid-then-valid-getter'].includes(mode);
      assert.deepEqual(result, refused ? config.refused ?? { kind: 'unavailable' } : config.accepted);
      assert.equal(calls, 1); assert.equal(propertyReads, 0);
      assert.deepEqual(diagnostics, refused ? [[config.code ?? 'operator_audit_read']] : []);
      assert.equal(child.aborted, true); assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
    });
  }
}
