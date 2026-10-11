import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNativeWorkerJson as parse } from '../src/server/native-worker-json.ts';

test('native worker decoder accepts original exact byte caps', () => {
  for (const cap of [16384,65536]) {
    const content = Buffer.from('{"text":"ø汉😀\uFFFD"}');
    const padded = Buffer.concat([content, Buffer.alloc(cap-content.length,32)]);
    assert.deepEqual(parse(padded,cap),{text:'ø汉😀\uFFFD'});
  }
});
test('native worker decoder charges bytes and refuses cap plus one', () => {
  for (const cap of [16384,65536]) {
    const padded = Buffer.concat([Buffer.from('{}'),Buffer.alloc(cap-1,32)]);
    Object.defineProperty(padded,'byteLength',{value:2});
    assert.throws(()=>parse(padded,cap));
  }
});
test('native worker decoder refuses nonnative empty and detached outputs', () => {
  const detached=new Uint8Array(2);structuredClone(detached.buffer,{transfer:[detached.buffer]});
  for (const input of ['{}',{},null,[123,125],Object.create(Uint8Array.prototype),new Uint8Array(),detached])
    assert.throws(()=>parse(input,16384));
});
test('native worker decoder ignores producer properties and observes Buffer offsets', () => {
  const parent=Buffer.from('xx{"text":"ø"}yy'),bytes=parent.subarray(2,parent.length-2);
  let calls=0;
  for (const name of ['byteLength','length','buffer','byteOffset',Symbol.iterator])
    Object.defineProperty(bytes,name,{get(){calls++;throw Error('INVENTED_PRIVATE_PROPERTY');}});
  assert.deepEqual(parse(bytes,16384),{text:'ø'});assert.equal(calls,0);
});
test('native worker decoder refuses malformed sequences and accepts literal replacement data', () => {
  for (const sequence of [[255],[192,175],[226,130],[237,160,128],[244,144,128,128]]) {
    const bytes=Buffer.concat([Buffer.from('{"text":"'),Buffer.from(sequence),Buffer.from('"}')]);
    assert.throws(()=>parse(bytes,16384));
  }
  assert.deepEqual(parse(Buffer.from('{"text":"\uFFFD"}'),16384),{text:'\uFFFD'});
});
test('native worker decoder preserves original BOM refusal and JSON value semantics', () => {
  assert.throws(()=>parse(Buffer.concat([Buffer.from([239,187,191]),Buffer.from('{}')]),16384),SyntaxError);
  assert.equal(parse(Buffer.from('1'),16384),1);
  assert.deepEqual(parse(Buffer.from(' \n{}\n'),16384),{});
});
test('native worker decoder preserves JSON parse failure without reading stderr', () => {
  assert.throws(()=>parse(Buffer.from('not JSON'),16384),SyntaxError);
  assert.throws(()=>parse(Buffer.from('{"text":'),16384),SyntaxError);
});
