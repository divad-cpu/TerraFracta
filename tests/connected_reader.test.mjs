import assert from "node:assert/strict";
import test from "node:test";
import { chmod, lstat, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseConnectedReaderInput, connectedEdition, connectedSearch } from "../src/connected-fictional-reader.ts";
import { ConnectedFictionalStore } from "../src/server/connected-fictional-store.ts";
import { connectedInput, suppressionInput } from "./helpers/connected_reader_fixture.mjs";

async function scratch(t) {
  const directory = await mkdtemp(join(tmpdir(), "tf-connected-reader-test-"));
  t.after(() => rm(directory, { recursive: true, force: true })); // This test's exclusive scratch directory only.
  return join(directory, "store");
}
test("an actual saved edition reopens in a new reader instance with private modes", async (t) => {
  const directory = await scratch(t);
  const store = new ConnectedFictionalStore(directory);
  assert.deepEqual(await store.current(), { kind: "empty" });
  const first = await store.append(connectedInput(), null);
  const reopened = await new ConnectedFictionalStore(directory).current(first.generation);
  assert.deepEqual(reopened, { kind: "snapshot", snapshot: first });
  assert.equal((await readdir(directory)).length, 1);
  assert.equal((await lstat(directory)).mode & 0o777, 0o700);
  assert.equal((await lstat(join(directory, "edition-001.json"))).mode & 0o777, 0o600);
});
test("a newer checked edition replaces all current reads and old links reveal no old claim", async (t) => {
  const directory = await scratch(t), store = new ConnectedFictionalStore(directory);
  const first = await store.append(connectedInput(), null);
  const second = await store.append(connectedInput("28.1"), first.generation);
  assert.equal(second.generation, 2);
  assert.deepEqual(await store.current(1), { kind: "changed", currentGeneration: 2 });
  assert.equal((await store.current()).snapshot.issue.claims[0].assertion, "In 2025, the fictional share was 28.1%.");
  assert.equal(JSON.parse(await readFile(join(directory, "edition-001.json"), "utf8")).issue.claims[0].assertion, first.issue.claims[0].assertion);
});
test("rights-withdrawn suppression removes the claim from the reader and search together", async (t) => {
  const store = new ConnectedFictionalStore(await scratch(t));
  await store.append(connectedInput(), null);
  const withdrawn = await store.append(suppressionInput(), 1);
  assert.equal(withdrawn.issue, null);
  assert.equal(connectedSearch(withdrawn, "fictional").matches, false);
  assert.deepEqual(await store.current(1), { kind: "changed", currentGeneration: 2 });
});
test("old expected heads and replay identities refuse publication and preserve earlier files", async (t) => {
  for (const kind of ["head", "replay"]) {
    const directory = await scratch(t), store = new ConnectedFictionalStore(directory);
    const input = connectedInput(); await store.append(input, null);
    const before = await readFile(join(directory, "edition-001.json"), "utf8");
    await assert.rejects(store.append(kind === "replay" ? input : connectedInput("28.1"), kind === "head" ? null : 1));
    assert.equal(await readFile(join(directory, "edition-001.json"), "utf8"), before);
    assert.ok((await readdir(directory)).includes(".writer-lock"), "failed writer boundary retained");
    assert.equal((await store.current()).kind, "snapshot");
  }
});
test("simultaneous writers have one winner and cannot overwrite a competing edition", async (t) => {
  const directory = await scratch(t), store = new ConnectedFictionalStore(directory);
  await store.append(connectedInput(), null);
  const results = await Promise.allSettled([store.append(connectedInput("28.1"), 1), new ConnectedFictionalStore(directory).append(connectedInput(), 1)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await store.current()).snapshot.generation, 2);
  assert.equal((await readdir(directory)).filter((name) => name.startsWith("edition-")).length, 2);
});
test("invalid or substituted newest editions never fall back to older content", async (t) => {
  for (const kind of ["malformed", "oversized", "symlink", "wrong-id", "permissions", "gap"]) {
    const directory = await scratch(t), store = new ConnectedFictionalStore(directory);
    await store.append(connectedInput(), null);
    const path = join(directory, kind === "gap" ? "edition-003.json" : "edition-002.json");
    if (kind === "symlink") await symlink(join(directory, "edition-001.json"), path);
    else await writeFile(path, kind === "oversized" ? "x".repeat(65 * 1024) : kind === "malformed" ? "{private-canary" : JSON.stringify({ ...connectedInput(), generation: 1 }), { mode: 0o600 });
    if (kind === "permissions") await chmod(path, 0o644);
    const outcome = await store.current();
    assert.deepEqual(outcome, { kind: "unavailable" });
    assert.ok(!JSON.stringify(outcome).includes("private-canary"));
    assert.equal((await readdir(directory)).filter((name) => name.startsWith("edition-")).length, 2);
  }
});
test("a linked or broadly readable root is refused without changing its permissions", async (t) => {
  const directory = await scratch(t), target = `${directory}-target`;
  await mkdir(target, { mode: 0o700 }); await symlink(target, directory);
  assert.deepEqual(await new ConnectedFictionalStore(directory).current(), { kind: "unavailable" });
  await assert.rejects(new ConnectedFictionalStore(directory).append(connectedInput(), null));
  assert.deepEqual(await readdir(target), []);
  const broad = await scratch(t);
  await mkdir(broad, { mode: 0o700 }); await chmod(broad, 0o755);
  assert.deepEqual(await new ConnectedFictionalStore(broad).current(), { kind: "unavailable" });
  await assert.rejects(new ConnectedFictionalStore(broad).append(connectedInput(), null));
  assert.equal((await lstat(broad)).mode & 0o777, 0o755);
  assert.deepEqual(await readdir(broad), []);
});
test("replaying an older execution after a successor cannot introduce a third edition", async (t) => {
  const directory = await scratch(t), store = new ConnectedFictionalStore(directory);
  const first = connectedInput(); await store.append(first, null);
  await store.append(connectedInput("28.1"), 1);
  await assert.rejects(store.append(first, 2));
  assert.equal((await store.current()).snapshot.generation, 2);
  assert.ok(!(await readdir(directory)).includes("edition-003.json"));
});
test("display data cannot introduce a real source, private field or arbitrary political wording", () => {
  const alterations = [
    (input) => { input.privateNote = "canary"; },
    (input) => { input.actualSourceRequests = 1; },
    (input) => { input.livePublicationEnabled = true; },
    (input) => { input.issue.jurisdictionSlug = "norway"; },
    (input) => { input.issue.claims[0].assertion = "A real government succeeded"; },
    (input) => { input.issue.summary += " A real government succeeded."; },
    (input) => { input.issue.claims[0].evidence[0].url = "https://www.ssb.no/source"; },
    (input) => { input.issue.claims[0].evidence[0].privateNote = "canary"; },
  ];
  for (const alter of alterations) { const input = connectedInput(); alter(input); assert.throws(() => parseConnectedReaderInput(input)); }
});
test("edition input cannot select files, arrays, negative values or an unlimited revision", () => {
  assert.equal(connectedEdition(undefined), null); assert.equal(connectedEdition("128"), 128);
  for (const input of ["0", "129", "01", "-1", "../1", ["1"], 1, null, "1&path=/private"]) assert.throws(() => connectedEdition(input));
});
test("search supports case, whitespace and Unicode normalization without private or SQL input", () => {
  const snapshot = { ...connectedInput(), generation: 1 };
  assert.equal(connectedSearch(snapshot, " FICTIONAL   2025 ").matches, true);
  assert.equal(connectedSearch(snapshot, "２７．４").matches, true);
  assert.equal(connectedSearch(snapshot, "missing topic").matches, false);
  for (const query of [[], "x".repeat(81), "secret\u0000field"]) assert.equal(connectedSearch(snapshot, query).kind, "invalid");
});
