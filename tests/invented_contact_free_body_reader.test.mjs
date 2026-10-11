import assert from "node:assert/strict";
import test from "node:test";
import { connectedInput } from "./helpers/connected_reader_fixture.mjs";
import { deriveCorrectionTarget } from "../src/correction-target.ts";
import { createInventedContactFreeBodyReader } from "../src/invented-contact-free-body-reader.ts";
import { createInventedContactFreeAdmission } from "../src/invented-contact-free-admission.ts";
const held = { kind: "held" }, encode = text => new TextEncoder().encode(text);
const current = () => ({ kind: "issue", issue: { ...connectedInput().issue,
  publicationId: "d8400000-6666-4666-8666-666666666666" } });
const packet = () => ({ schemaVersion: 1, requestId: "d8400000-1111-4111-8111-111111111111", draft: {
  target: deriveCorrectionTarget(current()).target,
  fields: { kind: "incorrect_statement", details: "Invented bytes only: blåbær 日本語.", sourceUrl: "https://example.org/invented-only" } } });
const json = () => JSON.stringify(packet());
function request(body = json(), headers = {}) {
  return new Request("https://example.org/invented-local-trial", { method: "POST", body,
    headers: { "content-type": "application/json", ...headers }, duplex: "half" });
}
const pool = clock => createInventedContactFreeBodyReader("fresh_invented_trial", clock);
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; }
function hanging() {
  const cancellation = deferred(); let pulls = 0, cancels = 0;
  const stream = new ReadableStream({ pull() { pulls++; }, cancel() { cancels++; return cancellation.promise; } }, { highWaterMark: 0 });
  return { cancellation, stream, pulls: () => pulls, cancels: () => cancels };
}
function excessWithStalledCancel() {
  const cancellation = deferred(); let cancels = 0;
  return { cancellation, stream: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(16_385)); },
    cancel() { cancels++; return cancellation.promise; } }, { highWaterMark: 0 }), cancels: () => cancels };
}

test("native Unicode bytes prepare against current projection without accepting a report", async () => {
  const reader = pool(), text = json(), result = await reader.prepare(request(text), current);
  assert.equal(result.kind, "prepared"); assert.equal(result.bodyBytes, encode(text).length);
  assert.ok(result.bodyBytes > text.length); assert.deepEqual(result.request, packet());
  assert.deepEqual(reader.inspection(), { activeReads: 0, held: false });
  assert.equal(reader.write, undefined); assert.equal(reader.receipt, undefined);
});

test("byte limit applies to stream with missing and misleading lower content-length", async () => {
  for (const headers of [{}, { "content-length": "1" }]) {
    let cancelled = 0;
    const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(16_385)); }, cancel() { cancelled++; } });
    const reader = pool(); assert.deepEqual(await reader.prepare(request(stream, headers), current), held);
    await flush(); assert.equal(cancelled, 1); assert.equal(reader.inspection().activeReads, 0);
  }
});

test("schema-valid body passes; exact16KiB noncanonical padding and overflow are held", async () => {
  const base = packet(); base.draft.fields.details = "x".repeat(1000);
  const text = JSON.stringify(base); // Request schema itself is smaller than16KiB.
  assert.equal((await pool().prepare(request(text), current)).kind, "prepared");
  const padded = text + " ".repeat(16_384 - encode(text).length);
  // Canonical grammar rejects trailing padding even when within the byte cap.
  assert.deepEqual(await pool().prepare(request(padded), current), held);
  assert.deepEqual(await pool().prepare(request(padded + " "), current), held);
});

test("split multibyte sequences preserve strict native UTF8 and byte count", async () => {
  const bytes = encode(json()); let offset = 0;
  const stream = new ReadableStream({ pull(c) { if (offset === bytes.length) c.close(); else c.enqueue(bytes.slice(offset, ++offset)); } }, { highWaterMark: 0 });
  const result = await pool().prepare(request(stream), current);
  assert.equal(result.kind, "prepared"); assert.equal(result.bodyBytes, bytes.length); assert.deepEqual(result.request, packet());
});

test("copies consumed chunks before producer changes them on a subsequent pull", async () => {
  const bytes = encode(json()), first = bytes.slice(0, 80), second = bytes.slice(80); let step = 0;
  const stream = new ReadableStream({ pull(c) {
    if (step++ === 0) c.enqueue(first);
    else if (step === 2) { first.fill(88); c.enqueue(second); }
    else { second.fill(88); c.close(); }
  } }, { highWaterMark: 0 });
  const result = await pool().prepare(request(stream), current);
  assert.equal(result.kind, "prepared"); assert.deepEqual(result.request, packet());
  assert.equal(first[0], 88); assert.equal(second[0], 88);
});

test("invalid UTF8, BOM, duplicates, escaped keys and noncanonical grammar remain opaque", async () => {
  const selected = json(); const cases = [new Uint8Array([0xc3, 0x28]), new Uint8Array([0xef,0xbb,0xbf,...encode(selected)]),
    selected.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
    selected.replace('"schemaVersion"', '"schema\\u0056ersion"'), selected + "\n", JSON.stringify(JSON.stringify(packet())), "null", "[]", "{}"];
  for (const body of cases) assert.deepEqual(await pool().prepare(request(body), current), held);
});

test("extra private/contact fields and invalid correction bounds are held", async () => {
  for (const mutate of [p => { p.email="invented@example.org"; }, p => { p.draft.fields.details="short"; },
    p => { p.draft.fields.sourceUrl="http://example.org"; }, p => { p.draft.target.revision++; }]) {
    const selected = packet(); mutate(selected);
    assert.deepEqual(await pool().prepare(request(JSON.stringify(selected)), current), held);
  }
});

test("current target is obtained after EOF and changed, absent or throwing current stays held", async () => {
  let calls = 0, changed = false; const bytes = encode(json());
  const stream = new ReadableStream({ start(c) { c.enqueue(bytes); }, pull(c) { changed=true; c.close(); } }, { highWaterMark: 0 });
  const result = await pool().prepare(request(stream), () => { calls++; const selected=current(); if (changed) selected.issue.revision++; return selected; });
  assert.deepEqual(result, held); assert.equal(calls, 1); assert.equal(changed, true);
  for (const get of [() => null, () => { throw Error("private current failure"); }]) assert.deepEqual(await pool().prepare(request(), get), held);
});

test("invalid method, content type and declared size do not read or consult target", async () => {
  for (const req of [new Request("https://example.org"), request(json(), { "content-type":"text/plain" }),
    ...["-1", "016", "16385", "999999999999999999999", "2.5"].map(v => request(json(), { "content-length":v }))]) {
    let calls=0; assert.deepEqual(await pool().prepare(req, () => { calls++; return current(); }), held);
    assert.equal(calls, 0); assert.equal(req.bodyUsed, false);
  }
});

test("used or locked native body is held without releasing someone else's lock", async () => {
  const used=request(); await used.text(); assert.deepEqual(await pool().prepare(used, current), held);
  const locked=request(), foreign=locked.body.getReader();
  assert.deepEqual(await pool().prepare(locked, current), held); assert.equal(locked.body.locked, true); foreign.releaseLock();
});

test("two physical cancelled reads keep slots until transport acknowledges, third never starts", async () => {
  const reader=pool(), first=excessWithStalledCancel(), second=excessWithStalledCancel();
  assert.deepEqual(await reader.prepare(request(first.stream), current), held);
  assert.deepEqual(await reader.prepare(request(second.stream), current), held);
  assert.deepEqual(reader.inspection(), { activeReads:2, held:false });
  const third=request(); assert.deepEqual(await reader.prepare(third, current), held); assert.equal(third.bodyUsed, false);
  assert.equal(first.cancels(),1); assert.equal(second.cancels(),1);
  first.cancellation.resolve(); await flush(); assert.equal(reader.inspection().activeReads,1);
  assert.equal((await reader.prepare(request(),current)).kind,"prepared");
  second.cancellation.resolve(); await flush(); assert.equal(reader.inspection().activeReads,0);
});

test("native parent cancellation is prompt even when stream cancellation never acknowledges", async () => {
  const reader=pool(), input=hanging(), controller=new AbortController();
  const req=new Request("https://example.org", {method:"POST", headers:{"content-type":"application/json"}, body:input.stream, duplex:"half", signal:controller.signal});
  const pending=reader.prepare(req,current); await flush(); assert.equal(input.pulls(),1); controller.abort();
  assert.deepEqual(await pending,held); assert.equal(reader.inspection().activeReads,1); assert.equal(input.cancels(),1);
  input.cancellation.resolve(); await flush(); assert.equal(reader.inspection().activeReads,0);
});

test("real2second observer deadline returns held and retains unsettled physical slot", async () => {
  const reader=pool(), input=hanging(), started=performance.now();
  assert.deepEqual(await reader.prepare(request(input.stream),current),held);
  assert.ok(performance.now()-started>=1900); assert.equal(reader.inspection().activeReads,1);
  input.cancellation.resolve(); await flush(); assert.equal(reader.inspection().activeReads,0);
});

test("delayed timer cannot expose prepared request after elapsed deadline", async () => {
  let time=0; const bytes=encode(json()), reader=pool(() => time);
  const stream=new ReadableStream({start(c){c.enqueue(bytes);},pull(c){time=2000;c.close();}}, {highWaterMark:0});
  assert.deepEqual(await reader.prepare(request(stream),current),held); await flush(); assert.equal(reader.inspection().activeReads,0);
});

test("clock reversal, nonfinite clock and context loss permanently hold this pool", async () => {
  for (const invalid of [-1,NaN,Infinity]) { let time=1; const reader=pool(() => time); assert.equal((await reader.prepare(request(),current)).kind,"prepared"); time=invalid;
    assert.deepEqual(await reader.prepare(request(),current),held); assert.equal(reader.inspection().held,true); time=2;
    assert.deepEqual(await reader.prepare(request(),current),held); }
  const reader=pool(); reader.loseContext(); assert.deepEqual(await reader.prepare(request(),current),held);
});

test("cleanup cancellation rejection prevents new preparation and never leaks thrown text", async () => {
  const input=excessWithStalledCancel(), reader=pool(); assert.deepEqual(await reader.prepare(request(input.stream),current),held);
  input.cancellation.reject(Error("invented private cancellation failure")); await flush();
  assert.deepEqual(reader.inspection(),{activeReads:0,held:true}); assert.deepEqual(await reader.prepare(request(),current),held);
});

test("listener cleanup failure holds successful parsed payload and blocks successor", async () => {
  const req=request(), reader=pool(); Object.defineProperty(req.signal,"removeEventListener",{ value(){throw Error("private cleanup failure");} });
  assert.deepEqual(await reader.prepare(req,current),held); assert.equal(reader.inspection().held,true);
  assert.deepEqual(await reader.prepare(request(),current),held);
});

test("listener setup failure does not dispatch physical read and permanently holds context", async () => {
  const req=request(), reader=pool(); Object.defineProperty(req.signal,"addEventListener",{ value(){throw Error("private setup failure");} });
  assert.deepEqual(await reader.prepare(req,current),held); assert.equal(req.bodyUsed,false);
  assert.deepEqual(reader.inspection(),{activeReads:0,held:true});
});

test("retired deadline callback cannot cancel a later physical read", async () => {
  const original=globalThis.setTimeout; let callback; globalThis.setTimeout=(fn) => {callback=fn; return 123;};
  const reader=pool(); let result;
  try { result=await reader.prepare(request(),current); } finally { globalThis.setTimeout=original; }
  assert.equal(result.kind,"prepared"); const input=hanging(), pending=reader.prepare(request(input.stream),current);
  callback(); assert.equal(input.cancels(),0); assert.equal(reader.inspection().activeReads,1);
  reader.loseContext(); assert.deepEqual(await pending,held); input.cancellation.resolve(); await flush();
});

test("target validation elapsed time is checked before private request exposure", async () => {
  let time=0; const reader=pool(() => time);
  assert.deepEqual(await reader.prepare(request(),() => {time=2000;return current();}),held);
});

test("zero length chunks cannot create an unbounded empty-chunk accumulator", async () => {
  let pulls=0; const reader=pool(), stream=new ReadableStream({pull(c){pulls++;c.enqueue(new Uint8Array(0));}}, {highWaterMark:0});
  assert.deepEqual(await reader.prepare(request(stream),current),held); await flush(); assert.equal(pulls,1);
});

test("measured prepared bytes feed existing invented budget without implying write settlement", async () => {
  const prepared=await pool().prepare(request(),current); assert.equal(prepared.kind,"prepared");
  const now=Date.parse("2026-10-08T01:00:00Z"), budget=createInventedContactFreeAdmission({kind:"fresh_invented_trial",openReports:0,acceptedAtMs:[]},()=>now);
  const ticket=budget.writer.begin({currentKey:"d8400000-4444-4444-8444-444444444444", previousKey:"d8400000-5555-4555-8555-555555555555",
    epoch:Math.floor(now/900000),bodyBytes:prepared.bodyBytes});
  assert.equal(ticket.kind,"reserved"); assert.equal(budget.inspection.counts().openReports,0);
  assert.equal(budget.writer.settle(ticket.token,"not_written").kind,"released");
});


test("regression: final clock context invalidation cannot expose a prepared payload", async () => {
  let reader, calls=0, invalidated=false;
  reader=pool(() => { calls++; if(calls>1 && reader.inspection().activeReads===0){invalidated=true;reader.loseContext();} return 0; });
  assert.deepEqual(await reader.prepare(request(),current),held); assert.equal(invalidated,true); assert.equal(reader.inspection().held,true);
});

test("regression: clock reentry cannot admit more than two physical reads", async () => {
  const streams=Array.from({length:3},hanging);let reader,reentered=false;const inner=[];
  reader=pool(() => {if(!reentered){reentered=true;inner.push(reader.prepare(request(streams[1].stream),current));inner.push(reader.prepare(request(streams[2].stream),current));}return 0;});
  const outer=reader.prepare(request(streams[0].stream),current);await flush();
  assert.ok(reader.inspection().activeReads<=2);assert.ok(streams.reduce((sum,value)=>sum+value.pulls(),0)<=2);
  reader.loseContext();streams.forEach(value=>value.cancellation.resolve());await Promise.all([outer,...inner]);await flush();
});

test("regression: producer-shadowed byteLength cannot hide actual oversized typed array", async () => {
  const bytes=new Uint8Array(16385);Object.defineProperty(bytes,"byteLength",{value:1});let pulls=0,cancels=0;
  const stream=new ReadableStream({pull(c){pulls++;if(pulls===1)c.enqueue(bytes);else c.close();},cancel(){cancels++;}},{highWaterMark:0});
  const reader=pool();assert.deepEqual(await reader.prepare(request(stream),current),held);await flush();
  assert.equal(pulls,1);assert.equal(cancels,1);assert.equal(reader.inspection().activeReads,0);
});


test("regression: final native aborted getter cannot invalidate and expose preparation",async()=>{
 const reader=pool(()=>0),req=request();let finalGets=0;
 Object.defineProperty(req.signal,"aborted",{get(){if(reader.inspection().activeReads===0&&++finalGets===2)reader.loseContext();return false;}});
 assert.deepEqual(await reader.prepare(req,current),held);assert.equal(finalGets,2);assert.equal(reader.inspection().held,true);
});


test("regression: context loss while obtaining or copying a chunk retires owned bytes before cancellation settles", async () => {
  for (const phase of ["value", "copy"]) {
    const reader=pool(()=>0), cancellation=deferred(), bytes=encode("INVENTED_READ_RESULT_CANARY");
    const stream=new ReadableStream({start(c){c.enqueue(bytes);},cancel(){return cancellation.promise;}},{highWaterMark:0});
    const req=request(stream), native=req.body.getReader.bind(req.body);
    if(phase==="value") Object.defineProperty(req.body,"getReader",{value(){const actual=native();return {
      async read(){const result=await actual.read();Object.defineProperty(result,"value",{get(){reader.loseContext();return bytes;}});return result;},
      cancel:()=>actual.cancel(),releaseLock:()=>actual.releaseLock()};}});
    const Original=globalThis.Uint8Array;let ownedCopy;
    globalThis.Uint8Array=new Proxy(Original,{construct(target,args,newTarget){const output=Reflect.construct(target,args,newTarget);
      if(args[0]===bytes){ownedCopy=output;if(phase==="copy")reader.loseContext();}return output;}});
    try {
      assert.deepEqual(await reader.prepare(req,()=>{throw Error("Target must not be consulted");}),held);
      await flush();assert.deepEqual(reader.inspection(),{activeReads:1,held:true});
      if(phase==="value")assert.equal(ownedCopy,undefined);
      else {assert.ok(ownedCopy instanceof Original);assert.equal(ownedCopy.some(value=>value!==0),false);}
    } finally {globalThis.Uint8Array=Original;cancellation.resolve();await flush();}
    assert.equal(reader.inspection().activeReads,0);
  }
});
