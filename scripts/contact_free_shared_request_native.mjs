// Invented native-body/shared-admission proof; fixed fresh-cluster driver only.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { checkInventedNodeFixture } from "./contact_free_node_fixture.mjs";
import { createInventedContactFreeClock, observeInventedContactFreeClock } from "../src/invented-contact-free-clock.ts";
import { createInventedContactFreeBodyReader } from "../src/invented-contact-free-body-reader.ts";
import { checkInventedContactFreeWriteObservation } from "../src/contact-free-write-observation.ts";
import { deriveCorrectionTarget } from "../src/correction-target.ts";
import { contactFreeCorrectionPolicy as limits } from "../src/contact-free-correction-policy.ts";
import { connectedInput } from "../tests/helpers/connected_reader_fixture.mjs";

const IMAGE = "sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453";
const BIN = "/nix/var/nix/profiles/default/bin/";
const assertions = [], commands = [];
let fixture, phase, completed = false, failLabel = null, physical = 0, retainedTicket = null;
let proofOwnerVerified = false;
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const flush = () => new Promise(resolve => setImmediate(resolve));
function check(label, actual, expected) {
  try { assert.deepEqual(actual, expected); assertions.push({ label, pass: true }); }
  catch { assertions.push({ label, pass: false }); failLabel = label; throw Error("Invented assertion held"); }
}
// Only closed command metadata is durable. Never retain SQL input, stderr or
// child error text. All fixed query results below contain invented data only.
function command(args, input = "", timeout = 8_000) {
  physical++;
  return new Promise((resolve, reject) => {
    let output = "", done = false, timedOut = false;
    const child = spawn("docker", ["--host", "unix:///var/run/docker.sock", ...args],
      { env: { PATH: "/usr/bin:/bin" }, stdio: ["pipe", "pipe", "ignore"] });
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, timeout);
    child.stdout.on("data", chunk => { output += chunk; if (output.length > 131_072) { timedOut = true; child.kill("SIGTERM"); } });
    function finish(code) {
      if (done) return; done = true; clearTimeout(timer); physical--;
      commands.push({ command: ["docker", "--host", "unix:///var/run/docker.sock", ...args],
        exitCode: code, timedOut });
      if (code === 0 && !timedOut) resolve(output); else reject(Error("Invented command held"));
    }
    child.on("error", () => finish(null)); child.on("close", finish);
    child.stdin.on("error", () => {}); child.stdin.end(input);
  });
}
function sql(text, role = null) {
  const prefix = role === null ? "" : "set session authorization " + role + ";";
  return command(["exec", "-i", fixture.container, BIN + "psql", "-h", "/tmp", "-U", "postgres",
    "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], prefix + text);
}
async function value(text, role = null) { return JSON.parse((await sql(text, role)).trim()); }
const shared = "tf_shared_admission_trial.";
const uuid = z.uuid().regex(/^[0-9a-f-]+$/);
const inputSchema = z.strictObject({ fixture: z.unknown(), phase: z.enum(["first", "replacement"]), ticket: uuid.nullable() })
  .refine(value => (value.phase === "first") === (value.ticket === null));
async function call(name, args, role = "tf_shared_writer") {
  return value("select " + shared + name + "(" + args.join(",") + ");", role);
}
async function counts() { return call("counts_invented", [quote(fixture.executionId)], "tf_shared_recovery"); }
async function begin() {
  return call("begin_invented", [quote(fixture.executionId), quote(randomUUID()), quote(randomUUID()),
    quote(randomUUID()), Math.floor(fixture.receivedAtMs / limits.addressWindowMs)]);
}
async function release(reservation) {
  return call("release_prewrite_invented", [quote(fixture.executionId), quote(reservation.ticket)]);
}
async function arm(reservation, packet) {
  return call("arm_invented", [quote(fixture.executionId), quote(reservation.ticket), quote(packet.requestId),
    quote(JSON.stringify(packet.draft.target)) + "::jsonb"]);
}
async function write(reservation, packet) {
  return call("write_invented", [quote(fixture.executionId), quote(reservation.ticket), quote(JSON.stringify(packet)) + "::jsonb"]);
}
async function resolve(ticket) {
  return call("resolve_invented", [quote(fixture.executionId), quote(ticket)], "tf_shared_recovery");
}
async function main() {
  if (process.argv.length !== 2) throw Error("Fixed fixture held");
  let raw = ""; for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 8192) throw Error("Fixture held"); }
  const input = inputSchema.parse(JSON.parse(raw)), parsed = checkInventedNodeFixture(input.fixture);
  if (parsed.kind !== "checked") throw Error("Fixture held");
  fixture = parsed.fixture; phase = input.phase;
  const meta = JSON.parse(await command(["inspect", fixture.container, "--format",
    '{"image":{{json .Image}},"labels":{{json .Config.Labels}},"network":{{json .HostConfig.NetworkMode}},"ports":{{json .NetworkSettings.Ports}},"mounts":{{json .Mounts}}}']));
  check("shared_exact_image", meta.image, IMAGE); check("shared_exact_label", meta.labels, { "terrafracta.write-node-trial": fixture.stamp });
  check("shared_network_none", meta.network, "none"); check("shared_no_ports", meta.ports, {});
  check("shared_only_owned_mount", meta.mounts.map(m => [m.Source, m.Destination]), [[fixture.clusterPath, "/trial"]]);
  proofOwnerVerified = true;
  const clock = createInventedContactFreeClock({ kind: "fresh_invented_clock", utcAtMs: fixture.receivedAtMs });
  if (clock.kind !== "ready") throw Error("Clock held");
  const reader = createInventedContactFreeBodyReader("fresh_invented_trial", () => {
    const snapshot = observeInventedContactFreeClock(clock.token);
    if (snapshot.kind !== "observed") throw Error("Clock held");
    return snapshot.observationAtMs;
  });
  const { claimId: _claim, ...identity } = fixture.target;
  const current = () => ({ kind: "issue", issue: { ...connectedInput().issue, ...identity } });
  check("shared_current_target", deriveCorrectionTarget(current()).target, fixture.target);
  const packet = () => ({ schemaVersion: 1, requestId: randomUUID(), draft: { target: fixture.target,
    fields: { kind: "missing_context", details: "INVENTED_SHARED_BODY_CANARY blåbær 日本語", sourceUrl: "https://example.org/INVENTED_ONLY" } } });
  const request = p => new Request("https://example.org/INVENTED_ONLY", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify(p) });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  async function wait(predicate) { const end = performance.now() + 1500; while (!predicate()) {
    if (performance.now() >= end) throw Error("Physical retirement held"); await flush(); } }

  if (phase === "replacement") {
    // A truly new native process/factory has no prior in-memory budget. Its new
    // body remains unread because the persisted shared reservation is unknown.
    check("replacement_prior_unknown", (await counts()).unknown, 1);
    const unread = request(packet());
    check("replacement_prebody_shared_gate", await begin(), { kind: "held" });
    check("replacement_body_unread", unread.bodyUsed, false);
    check("replacement_new_reader_unused", reader.inspection().activeReads, 0);
    const resolved = await resolve(input.ticket);
    check("replacement_explicit_original_effect", resolved.outcome, "confirmed");
    check("replacement_effect_not_repeat", resolved.result.replayed, false);
    check("replacement_original_received", resolved.result.lifecycle.receivedAtMs, fixture.receivedAtMs);
    check("replacement_metadata_excludes_body", JSON.stringify(resolved).includes("CANARY"), false);
    check("replacement_new_effect_counted_once", (await counts()).acceptedInHour, 2);
    check("replacement_shared_unknown_released", (await counts()).unknown, 0);
    check("replacement_repeated_resolution_held", await resolve(input.ticket), { kind: "held" });
    const after = await begin(); check("replacement_after_explicit_resolve_admitted", after.kind, "reserved_invented");
    check("replacement_unread_prewrite_release", await release(after), { kind: "released_invented" });
  } else {
    const valid = packet(), nativeRequest = request(valid), reservation = await begin();
    check("first_shared_reserved_before_body", reservation.kind, "reserved_invented");
    check("first_native_body_unread_at_reservation", nativeRequest.bodyUsed, false);
    const prepared = await reader.prepare(nativeRequest, current);
    check("first_actual_native_unicode_prepared", prepared.kind, "prepared");
    check("first_body_physical_retired", reader.inspection().activeReads, 0);
    check("first_shared_arm_after_eof", (await arm(reservation, prepared.request)).kind, "armed_invented");
    const result = await write(reservation, prepared.request);
    const checked = checkInventedContactFreeWriteObservation(result, { executionId: fixture.executionId,
      operationId: reservation.operationId, requestId: valid.requestId, target: fixture.target,
      admittedAtMs: reservation.admittedAtMs }, fixture.receivedAtMs);
    check("first_actual_current_custody_confirmed", checked.kind, "confirmed");
    check("first_core_receipt_excludes_body", JSON.stringify(checked).includes("CANARY"), false);
    check("first_confirmation_keeps_shared_unknown", (await counts()).unknown, 1);
    check("first_explicit_metadata_settlement", (await resolve(reservation.ticket)).outcome, "confirmed");
    check("first_shared_effect_counted_once", (await counts()).acceptedInHour, 1);

    const oversized = new Request("https://example.org/INVENTED_ONLY", { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(limits.bodyBytes + 1) });
    const largeReservation = await begin();
    check("cap_shared_reserved_before_measurement", largeReservation.kind, "reserved_invented");
    check("cap_native_reader_held", await reader.prepare(oversized, current), { kind: "held" });
    await wait(() => reader.inspection().activeReads === 0);
    check("cap_physical_retired_before_release", reader.inspection().activeReads, 0);
    check("cap_known_prewrite_released", await release(largeReservation), { kind: "released_invented" });
    check("cap_no_new_effect", (await counts()).acceptedInHour, 1);

    // Native read/cancel work stays pending after parent observation retirement.
    let finishCancel, pulled = false;
    const controller = new AbortController();
    const stalled = new Request("https://example.org/INVENTED_ONLY", { method: "POST", duplex: "half",
      headers: { "content-type": "application/json" }, signal: controller.signal,
      body: new ReadableStream({ pull() { pulled = true; return new Promise(() => {}); },
        cancel() { return new Promise(resolve => { finishCancel = resolve; }); } }, { highWaterMark: 0 }) });
    const stalledReservation = await begin(), pending = reader.prepare(stalled, current);
    await wait(() => pulled); controller.abort();
    check("cancel_native_observer_held", await pending, { kind: "held" });
    check("cancel_physical_reader_owned", reader.inspection().activeReads, 1);
    check("cancel_shared_reservation_still_owned", (await counts()).reserved, 1);
    const second = await begin(); check("cancel_second_shared_slot_only", second.kind, "reserved_invented");
    const thirdRequest = request(packet());
    check("cancel_third_worker_before_body_held", await begin(), { kind: "held" });
    check("cancel_third_worker_body_unread", thirdRequest.bodyUsed, false);
    check("cancel_no_prewrite_release_during_physical", (await counts()).reserved, 2);
    finishCancel(); await wait(() => reader.inspection().activeReads === 0);
    check("cancel_physical_retired", reader.inspection().activeReads, 0);
    check("cancel_original_prewrite_release_after_retirement", await release(stalledReservation), { kind: "released_invented" });
    check("cancel_second_unused_prewrite_release", await release(second), { kind: "released_invented" });
    check("cancel_no_new_effect", (await counts()).acceptedInHour, 1);

    const lostPacket = packet(), lost = await begin(), lostPrepared = await reader.prepare(request(lostPacket), current);
    check("lost_native_prepared", lostPrepared.kind, "prepared");
    check("lost_native_retired", reader.inspection().activeReads, 0);
    check("lost_shared_armed", (await arm(lost, lostPrepared.request)).kind, "armed_invented");
    const committed = await write(lost, lostPrepared.request);
    check("lost_actual_commit_before_injected_ack_loss", committed.outcome, "confirmed");
    // Deliberately discard the caller confirmation. Do not settle or resubmit.
    check("lost_shared_unknown_persists", (await counts()).unknown, 1);
    check("lost_effect_not_yet_counted", (await counts()).acceptedInHour, 1);
    retainedTicket = lost.ticket;
  }
  check("shared_physical_commands_retired", physical, 0);
  check("shared_no_staging_records", Number((await sql("select count(*) from tf_bound_trial.records;")).trim()), 0);
  check("shared_no_staging_payloads", Number((await sql("select count(*) from tf_bound_trial.payloads;")).trim()), 0);
  completed = true;
}
try { await main(); } catch { process.exitCode = 1; }
process.stdout.write(JSON.stringify({ schemaVersion: 1, evidenceKind: "invented_native_shared_request",
  phase: phase ?? null, completed, failureLabel: failLabel, assertions, commands, ticket: retainedTicket,
  proofOwnerVerified, primaryDatabaseTouched: false, actualSourceRequests: 0, liveIntakeEnabled: false,
  hostAuthenticationVerified: false, actualServiceRestartVerified: false }) + "\n");
