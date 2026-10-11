import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { handleFictionalUpdateRequest } from '../src/server/fictional-update-operation.ts';
import { createPrivateCustodianHandler } from '../src/server/private-custodian-operation.ts';
const encode = value => new TextEncoder().encode(value);
const fixture = JSON.parse(readFileSync(new URL('../fixtures/fictional_update_report.json', import.meta.url), 'utf8'));
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
for (const kind of ['update', 'custodian']) {
  for (const mode of ['invalid-then-valid', 'valid-then-invalid', 'reused-byte-buffer']) {
    test(`${kind}: delivered body bytes survive native producer buffer reuse (${mode})`, async () => {
      const valid = kind === 'update' ? '{"trigger":"manual"}' : '{"action":"run_invented_custodian"}';
      const invalid = kind === 'update' ? '{"trigger":"banana"}' : '{"action":"bad_invented_custodian"}';
      assert.equal(encode(valid).length, encode(invalid).length);
      const raw = encode(mode === 'invalid-then-valid' ? invalid : valid);
      let pulls = 0, starts = 0, inspects = 0, archives = 0, diagnostics = 0;
      const byte = new Uint8Array(1);
      const body = new ReadableStream({ pull(controller) {
        if (mode === 'reused-byte-buffer') {
          if (pulls < raw.length) { byte[0] = raw[pulls++]; controller.enqueue(byte); }
          else { pulls++; byte[0] = 0; controller.close(); }
        } else if (pulls++ === 0) controller.enqueue(raw);
        else { raw.set(encode(mode === 'invalid-then-valid' ? valid : invalid)); controller.close(); }
      } }, { highWaterMark: 0 });
      const req = new Request(`http://127.0.0.1:3000/api/dev/${kind}`, { method: 'POST', body, duplex: 'half', headers: { origin: 'http://127.0.0.1:3000', 'content-type': 'application/json' } });
      const record = async () => { diagnostics++; return 'unavailable'; };
      const handler = kind === 'update' ? (r, e) => handleFictionalUpdateRequest(r, e, async trigger => {
        starts++; return { ...structuredClone(fixture), trigger, scheduledDueAt: null, requestKey: 'fictional:manual:2026w40' };
      }, async () => { archives++; }, record) : createPrivateCustodianHandler({ inspect: async () => { inspects++; return { state: 'idle' }; }, start: async () => { starts++; return { state: 'held', reason: 'private_test_unavailable' }; } }, { status: { state: 'idle' } }, record);
      const response = await handler(req, 'development'); await flush();
      const admitted = mode !== 'invalid-then-valid';
      assert.equal(response.status, admitted ? kind === 'update' ? 200 : 202 : 400);
      assert.equal(starts, admitted ? 1 : 0); assert.equal(inspects, admitted && kind === 'custodian' ? 1 : 0); assert.equal(archives, admitted && kind === 'update' ? 1 : 0);
      assert.equal(diagnostics, 0); assert.equal(body.locked, false);
      if (!admitted) assert.deepEqual(await response.json(), { error: kind === 'update' ? 'invalid_rehearsal_request' : 'invalid_private_test_request' });
    });
  }
}
for (const kind of ['update', 'custodian']) {
  for (const fault of ['zero-chunk', 'shadowed-overflow', 'shadowed-valid', 'shadowed-exact', 'offset-buffer']) {
    test(`${kind}: native byte accounting and copying (${fault})`, async () => {
      const limit = kind === 'update' ? 128 : 64;
      const valid = kind === 'update' ? '{"trigger":"manual"}' : '{"action":"run_invented_custodian"}';
      let bytes = fault === 'shadowed-overflow' ? new Uint8Array(limit + 1) : encode(valid + (fault === 'shadowed-exact' ? ' '.repeat(limit - encode(valid).length) : ''));
      if (fault === 'shadowed-overflow' || fault === 'shadowed-exact') Object.defineProperty(bytes, 'byteLength', { value: 1 });
      if (fault === 'shadowed-valid') Object.defineProperty(bytes, 'byteLength', { get() { throw Error('INVENTED_BYTE_PROPERTY'); } });
      if (fault === 'offset-buffer') { const outer = Buffer.from('prefix:' + valid + ':suffix'); bytes = outer.subarray(7, 7 + encode(valid).length); }
      let pulls = 0, cancelled = 0, starts = 0, inspects = 0, archives = 0, diagnostics = 0;
      const body = new ReadableStream({ pull(c) {
        if (pulls++ === 0) c.enqueue(fault === 'zero-chunk' ? new Uint8Array() : bytes);
        else if (fault === 'zero-chunk' && pulls === 2) c.enqueue(encode(valid));
        else c.close();
      }, cancel() { cancelled++; } }, { highWaterMark: 0 });
      const req = new Request(`http://127.0.0.1:3000/api/dev/${kind}`, { method: 'POST', body, duplex: 'half', headers: { origin: 'http://127.0.0.1:3000', 'content-type': 'application/json' } });
      const record = async () => { diagnostics++; return 'unavailable'; };
      const handler = kind === 'update' ? (r, e) => handleFictionalUpdateRequest(r, e, async trigger => { starts++; return { ...structuredClone(fixture), trigger, scheduledDueAt: null, requestKey: 'fictional:manual:2026w40' }; }, async () => { archives++; }, record) : createPrivateCustodianHandler({ inspect: async () => { inspects++; return { state: 'idle' }; }, start: async () => { starts++; return { state: 'held', reason: 'private_test_unavailable' }; } }, { status: { state: 'idle' } }, record);
      const response = await handler(req, 'development'); await flush();
      const refused = ['zero-chunk', 'shadowed-overflow'].includes(fault);
      assert.equal(response.status, refused ? 400 : kind === 'update' ? 200 : 202);
      if (refused) { assert.equal(pulls, 1); assert.equal(cancelled, 1); }
      assert.equal(starts, refused ? 0 : 1); assert.equal(inspects, !refused && kind === 'custodian' ? 1 : 0); assert.equal(archives, !refused && kind === 'update' ? 1 : 0); assert.equal(diagnostics, 0); assert.equal(body.locked, false);
    });
  }
}
