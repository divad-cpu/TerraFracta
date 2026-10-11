import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseConnectedReaderInput, parseConnectedReaderSnapshot } from "../src/connected-fictional-reader.ts";
import { ConnectedFictionalStore } from "../src/server/connected-fictional-store.ts";
import { connectedInput, suppressionInput } from "./helpers/connected_reader_fixture.mjs";

function active(observedAt, retrievedAt = observedAt, day = "2026-10-01") {
  const input = connectedInput(); input.observedAt = observedAt;
  input.issue.claims[0].evidence[0].retrievedAt = retrievedAt;
  input.issue.lastEvidenceReviewOn = day; return input;
}
async function scratch(t) {
  const parent = await mkdtemp(join(tmpdir(), "tf-connected-time-test-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  return join(parent, "archive");
}
test("a source one nanosecond beyond observation is rejected in input and saved snapshot", () => {
  const input = active("2026-10-01T12:00:00Z", "2026-10-01T12:00:00.000000001Z");
  assert.throws(() => parseConnectedReaderInput(input), /timing/);
  assert.throws(() => parseConnectedReaderSnapshot({ ...input, generation: 1 }), /timing/);
});
test("distinct long decimal fractions cannot borrow the same millisecond", () => {
  const input = active("2026-10-01T12:00:00.123456789123456789Z", "2026-10-01T12:00:00.123456789123456790Z");
  assert.throws(() => parseConnectedReaderInput(input), /timing/);
});
test("equivalent offset and zero-padded decimal instants keep their original spelling", () => {
  const input = active("2026-10-01T14:00:00.123456789+02:00", "2026-10-01T07:00:00.123456789000-05:00");
  assert.deepEqual(parseConnectedReaderInput(input), input);
});
test("pre-epoch observations retain fraction order and valid earlier source support", () => {
  const earlier = active("1969-12-31T23:59:59.000000002Z", "1969-12-31T23:59:59.000000001Z", "1969-12-31");
  assert.deepEqual(parseConnectedReaderInput(earlier), earlier);
  const future = active("1969-12-31T23:59:59.000000001Z", "1969-12-31T23:59:59.000000002Z", "1969-12-31");
  assert.throws(() => parseConnectedReaderInput(future), /timing/);
});
test("evidence review days still use UTC dates across offset midnight", () => {
  const input = active("2026-10-02T00:30:00.000000001+02:00", "2026-10-01T22:29:59.999999999Z");
  assert.deepEqual(parseConnectedReaderInput(input), input);
  input.issue.lastEvidenceReviewOn = "2026-10-02";
  assert.throws(() => parseConnectedReaderInput(input), /timing/);
});
for (const state of ["active", "suppressed"]) {
  test(`an older ${state} observation cannot create a new edition or rewrite its head`, async (t) => {
    const directory = await scratch(t), store = new ConnectedFictionalStore(directory);
    await store.append(active("2026-10-01T12:00:00.123456789Z"), null);
    const path = join(directory, "edition-001.json"), before = await readFile(path);
    const input = state === "active" ? active("2026-10-01T12:00:00.123456788Z") : suppressionInput();
    input.observedAt = "2026-10-01T14:00:00.123456788+02:00";
    await assert.rejects(store.append(input, 1), /predates/);
    assert.deepEqual(await readFile(path), before);
    assert.deepEqual((await readdir(directory)).sort(), [".writer-lock", "edition-001.json"]);
    assert.equal((await store.current()).snapshot.generation, 1);
  });
}
test("an equal offset spelling and a strictly later sub-millisecond edition both reopen", async (t) => {
  const store = new ConnectedFictionalStore(await scratch(t));
  await store.append(active("2026-10-01T12:00:00.123456789Z"), null);
  await store.append(active("2026-10-01T14:00:00.123456789000+02:00"), 1);
  const next = active("2026-10-01T12:00:00.123456790Z");
  await store.append(next, 2);
  const current = await store.current();
  assert.equal(current.snapshot.generation, 3); assert.equal(current.snapshot.observedAt, next.observedAt);
});
test("invalid time grammar still refuses before creating an archive", async (t) => {
  const directory = await scratch(t), input = active("2026-10-01T12:00:00Z");
  input.observedAt = "2026-10-01T12:00:00.123456789garbageZ";
  await assert.rejects(new ConnectedFictionalStore(directory).append(input, null));
  await assert.rejects(readdir(directory), { code: "ENOENT" });
});
