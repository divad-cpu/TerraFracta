import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareProposalCaptureCommand, verifyProposalCaptureReceipt } from '../src/server/proposal-capture-command.ts';
import { proposedPayload, proposalId } from './helpers/proposal_fixture.mjs';

const selection = { captureId: proposalId(38), runId: proposalId(1), decisionId: proposalId(32),
  issueId: proposalId(7), basePublicationId: proposalId(6) };
const command = prepareProposalCaptureCommand(selection, proposedPayload());
const receipt = { ...selection, schemaVersion: 1, status: 'stored', proposalSha256: command.proposalSha256,
  capturedAt: '2026-09-28T07:00:00.000001Z', observedAt: '2026-09-28T07:00:00.000001Z' };
const text = JSON.stringify(receipt), encode = x => new TextEncoder().encode(x);
for (const mode of ['invalid-then-valid-getter', 'valid-then-invalid-getter', 'throwing-getter',
    'shadowed-exact', 'shadowed-large', 'offset-buffer', 'actual-overflow']) {
  test(`capture receipt checks actual native bytes (${mode})`, () => {
    let value = encode(text + (mode === 'shadowed-exact' ? ' '.repeat(2048 - text.length) :
      mode === 'actual-overflow' ? ' '.repeat(2049 - text.length) : ''));
    let propertyReads = 0;
    if (mode === 'invalid-then-valid-getter' || mode === 'valid-then-invalid-getter') {
      const initial = value[0];
      if (mode === 'invalid-then-valid-getter') value[0] = 33;
      Object.defineProperty(value, 'byteLength', { get() {
        propertyReads++; value[0] = mode === 'invalid-then-valid-getter' ? initial : 33; return text.length;
      } });
    }
    if (mode === 'throwing-getter') Object.defineProperty(value, 'byteLength', { get() { propertyReads++; throw Error('PRIVATE_RECEIPT_PROPERTY'); } });
    if (mode === 'shadowed-exact') Object.defineProperty(value, 'byteLength', { value: 1 });
    if (mode === 'shadowed-large') Object.defineProperty(value, 'byteLength', { value: 2049 });
    if (mode === 'actual-overflow') Object.defineProperty(value, 'byteLength', { value: text.length });
    if (mode === 'offset-buffer') value = Buffer.from('prefix' + text + 'suffix').subarray(6, 6 + text.length);
    if (mode === 'invalid-then-valid-getter' || mode === 'actual-overflow') assert.throws(() => verifyProposalCaptureReceipt(value, command));
    else assert.deepEqual(verifyProposalCaptureReceipt(value, command), receipt);
    assert.equal(propertyReads, 0);
    assert.ok(Object.isFrozen(command));
    assert.deepEqual(command.selection, selection);
  });
}
