import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import test from 'node:test';
import { createDiagnosticIntake } from '../src/server/error-log-intake.ts';

const eventId = '11111111-1111-4111-8111-111111111111';
const valid = JSON.stringify({ eventId, code: 'browser_runtime' });
const invalid = JSON.stringify({ eventId, code: 'private_runtime' });
const encode = value => new TextEncoder().encode(value);
assert.equal(valid.length, invalid.length);
for (const mode of ['invalid-then-valid', 'valid-then-invalid', 'reused-byte-buffer',
    'zero-chunk', 'shadowed-overflow', 'shadowed-valid', 'shadowed-exact', 'offset-buffer']) {
  test(`diagnostic native intent preserves actual bytes (${mode})`, async () => {
    let value = encode(mode === 'invalid-then-valid' ? invalid : valid);
    if (mode === 'shadowed-overflow') value = encode(valid + ' '.repeat(257 - valid.length));
    if (mode === 'shadowed-exact') value = encode(valid + ' '.repeat(256 - valid.length));
    if (mode === 'shadowed-overflow' || mode === 'shadowed-exact') Object.defineProperty(value, 'byteLength', { value: 1 });
    if (mode === 'shadowed-valid') Object.defineProperty(value, 'byteLength', { get() { throw Error('PRIVATE_PROPERTY_NOT_LOGGED'); } });
    if (mode === 'offset-buffer') value = Buffer.from('prefix' + valid + 'suffix').subarray(6, 6 + valid.length);
    let pulls = 0, cancels = 0;
    const single = new Uint8Array(1);
    const body = new ReadableStream({ pull(c) {
      if (mode === 'reused-byte-buffer') {
        if (pulls < value.length) { single[0] = value[pulls++]; c.enqueue(single); }
        else { pulls++; single[0] = 0; c.close(); }
      } else if (pulls++ === 0) c.enqueue(mode === 'zero-chunk' ? new Uint8Array() : value);
      else if (mode === 'zero-chunk' && pulls === 2) c.enqueue(encode(valid));
      else {
        if (mode === 'invalid-then-valid') value.set(encode(valid));
        if (mode === 'valid-then-invalid') value.set(encode(invalid));
        c.close();
      }
    }, cancel() { cancels++; } }, { highWaterMark: 0 });
    const request = new Request('http://127.0.0.1:3000/api/dev/error-log', { method: 'POST', body, duplex: 'half',
      headers: { origin: 'http://127.0.0.1:3000', 'content-type': 'application/json' } });
    const saved = [];
    const intake = createDiagnosticIntake(async (...args) => { saved.push(args); return 'saved'; }, () => 0);
    const response = await intake(request, 'development');
    const refused = ['invalid-then-valid', 'zero-chunk', 'shadowed-overflow'].includes(mode);
    assert.equal(response.status, refused ? 400 : 204);
    assert.equal(await response.text(), '');
    assert.deepEqual(saved, refused ? [] : [['browser_runtime', eventId]]);
    if (mode === 'zero-chunk' || mode === 'shadowed-overflow') { assert.equal(pulls, 1); assert.equal(cancels, 1); }
    assert.equal(body.locked, false);
    assert.equal(getEventListeners(request.signal, 'abort').length, 0);
  });
}
