import assert from 'node:assert/strict';
import test from 'node:test';
import { readLocalResponseJson } from '../src/local-response-json.ts';
const encode = value => new TextEncoder().encode(value);
const expected = { checked: true };
const plain = JSON.stringify(expected);
for (const fault of ['hidden-json-tail', 'hidden-garbage-tail', 'hidden-invalid-utf8', 'throwing-byte-length', 'mutating-byte-length', 'exact-capacity', 'offset-buffer', 'actual-overflow']) {
  test(`local response accounts for every native delivered byte (${fault})`, async () => {
    const limit = 1024;
    let raw = encode(plain), cancelled = 0, pulls = 0;
    if (fault === 'hidden-json-tail') raw = encode(plain + '{"unexpected":true}');
    if (fault === 'hidden-garbage-tail') raw = encode(plain + 'INVENTED_EXTRA_BYTES');
    if (fault === 'hidden-invalid-utf8') { raw = new Uint8Array(encode(plain).length + 1); raw.set(encode(plain)); raw[raw.length - 1] = 255; }
    if (fault === 'exact-capacity') raw = encode(plain + ' '.repeat(limit - encode(plain).length));
    if (fault === 'actual-overflow') raw = encode(plain + ' '.repeat(limit + 1 - encode(plain).length));
    if (['hidden-json-tail', 'hidden-garbage-tail', 'hidden-invalid-utf8', 'exact-capacity', 'actual-overflow'].includes(fault)) Object.defineProperty(raw, 'byteLength', { value: encode(plain).length });
    if (fault === 'throwing-byte-length') Object.defineProperty(raw, 'byteLength', { get() { throw Error('INVENTED_PRODUCER_PROPERTY'); } });
    if (fault === 'mutating-byte-length') Object.defineProperty(raw, 'byteLength', { get() { raw.set(encode('{"checked":null}')); return encode(plain).length; } });
    if (fault === 'offset-buffer') { const outer = Buffer.from('prefix:' + plain + ':suffix'); raw = outer.subarray(7, 7 + encode(plain).length); }
    const body = new ReadableStream({ pull(controller) { if (pulls++ === 0) controller.enqueue(raw); else controller.close(); }, cancel() { cancelled++; } }, { highWaterMark: 0 });
    const pending = readLocalResponseJson(new Response(body), new AbortController().signal, limit);
    const refused = fault.startsWith('hidden-') || fault === 'actual-overflow';
    if (refused) await assert.rejects(pending, error => error.message === 'Local response unavailable');
    else assert.deepEqual(await pending, expected);
    assert.equal(body.locked, false);
    if (fault === 'actual-overflow') { assert.equal(pulls, 1); assert.equal(cancelled, 1); }
  });
}
