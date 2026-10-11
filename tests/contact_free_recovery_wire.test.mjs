import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
const path = new URL("../scripts/check_contact_free_recovery_plan.mjs", import.meta.url);
const packet = () => ({ backup: { schemaVersion: 1, kind: "invented_backup_inventory", copiedAtMs: 100, records: [] },
  latest: { schemaVersion: 1, kind: "invented_latest_inventory", complete: true, observedAtMs: 200, records: [] }, nowMs: 200 });
function run(input, args = []) {
  return spawnSync(process.execPath, ["--experimental-strip-types", path.pathname, ...args],
    { input, encoding: "utf8", env: { PATH: "/usr/bin:/bin" }, timeout: 5000, maxBuffer: 1024 * 1024 });
}
function refused(input, args) {
  const result = run(input, args);
  assert.equal(result.status, 2); assert.deepEqual(JSON.parse(result.stdout), { kind: "held" });
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_CANARY/);
}

test("canonical bounded fixture inventory yields one structured plan and no external operation", () => {
  const result = run(JSON.stringify(packet()));
  assert.equal(result.status, 0); assert.equal(result.signal, null);
  assert.deepEqual(JSON.parse(result.stdout), { kind: "planned", observedAtMs: 200, actions: [] });
});

test("duplicate keys, escaped aliases and noncanonical wire encodings cannot supply recovery authority", () => {
  const good = JSON.stringify(packet());
  for (const text of [good.replace('"nowMs":200', '"nowMs":199,"nowMs":200'),
    good.replace('"nowMs"', '"now\\u004ds"'), " " + good, good + "\n", JSON.stringify(packet(), null, 2),
    good.replace('"complete":true', '"complete":false,"complete":true'), "\ufeff" + good]) refused(text);
});

test("invalid UTF-8, malformed JSON, unsupported fields and oversized wire remain opaque", () => {
  for (const input of [Buffer.from([0xc3, 0x28]), "{", "null", "[]", "{}", " ".repeat(512 * 1024 + 1),
    JSON.stringify({ ...packet(), body: "PRIVATE_CANARY" }),
    JSON.stringify({ ...packet(), latest: { ...packet().latest, complete: false } })]) refused(input);
});

test("caller arguments cannot choose another inventory or change the fixture mode", () => {
  refused(JSON.stringify(packet()), ["PRIVATE_CANARY"]);
});
