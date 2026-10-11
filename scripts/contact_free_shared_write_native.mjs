import { proveInventedSharedArmCancellation, proveInventedSharedReserveTimeout } from "./contact_free_shared_arm_cancel_case.mjs";
import { proveInventedSharedTargetRefusal } from "./contact_free_shared_target_refusal_case.mjs";
// Invented native-body/shared-admission proof; fixed fresh-cluster driver only.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { checkInventedNodeFixture } from "./contact_free_node_fixture.mjs";
import { createInventedContactFreeClock, observeInventedContactFreeClock } from "../src/invented-contact-free-clock.ts";
import { createInventedContactFreeSharedWriteTrial } from "../src/invented-contact-free-shared-write-trial.ts";
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

  // I retires the original body before minting an opaque one-shot handoff.
  // A claims that same Request/packet and immutable E operation/admission.
  // No internal reserialization/re-read or host/restart authority follows.
  if (phase === "replacement") {
    check("replacement_durable_unknown", (await counts()).unknown, 1);
    const unread = request(packet());
    check("replacement_prebody_held", await begin(), { kind: "held" });
    check("replacement_body_unread", unread.bodyUsed, false);
    const result = await resolve(input.ticket);
    check("replacement_original_effect", result.outcome, "confirmed");
    check("replacement_original_received", result.result.lifecycle.receivedAtMs, fixture.receivedAtMs);
    check("replacement_original_effect_not_replayed", result.result.replayed, false);
    check("replacement_metadata_no_body", JSON.stringify(result).includes("CANARY"), false);
    check("replacement_count_once", (await counts()).acceptedInHour, 1);
    check("replacement_no_unknown", (await counts()).unknown, 0);
    check("replacement_no_second_resolution", await resolve(input.ticket), { kind: "held" });
    await proveInventedSharedTargetRefusal({check,call,counts,fixture,clock,current,packet,quote,sql});
  } else {
    await proveInventedSharedReserveTimeout({ check, call, value, counts, fixture, clock, current, packet, wait, quote });
    await proveInventedSharedArmCancellation({ check, call, value, counts, fixture, clock, current, packet, wait, quote, sql });
    const original = packet(), parent = new AbortController();
    const incoming = new Request("https://example.org/INVENTED_ONLY", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(original), signal: parent.signal });
    let reserveCalls = 0, writeCalls = 0, releaseCalls = 0, reservation, prewriteReservation, startPort;
    const portStarted = new Promise(resolve => { startPort = resolve; });
    const trial = createInventedContactFreeSharedWriteTrial({ executionId: fixture.executionId,
      async reserve(input, signal) {
        reserveCalls++;
        if (reserveCalls === 2) check("bridge_shared_reserve_before_original_body", incoming.bodyUsed, false);
        reservation = await call("begin_invented", [quote(input.executionId), quote(input.operationId),
          quote(input.currentKey), quote(input.previousKey), input.epoch]);
        if (reserveCalls === 1) {
          prewriteReservation = reservation;
          check("prewrite_SQL_reserved_before_read", reservation.kind, "reserved_invented");
        } else {
          check("bridge_SQL_issued_original_operation", reservation.operationId, input.operationId);
          check("bridge_SQL_original_admission", reservation.admittedAtMs, fixture.receivedAtMs);
        }
        return reservation;
      },
      async arm(input, signal) {
        check("bridge_original_body_consumed_once_before_arm", incoming.bodyUsed, true);
        check("bridge_arm_exact_original_ticket", input.ticket, reservation.ticket);
        check("bridge_arm_exact_original_request", input.requestId, original.requestId);
        return call("arm_invented", [quote(input.executionId), quote(input.ticket), quote(input.requestId), quote(JSON.stringify(input.target)) + "::jsonb"]);
      },
      async write(input, signal) {
        writeCalls++;
        check("bridge_write_exact_prepared_packet", input.request, original);
        check("bridge_write_exact_original_ticket", input.ticket, reservation.ticket);
        const pending = value("begin;select pg_sleep(0.35);select " + shared + "write_invented(" +
          [quote(input.executionId), quote(input.ticket), quote(JSON.stringify(input.request)) + "::jsonb"].join(",") + ");commit;", "tf_shared_writer");
        startPort(); const committed = await pending;
        check("bridge_actual_SQL_committed_after_parent_abort", committed.outcome, "confirmed");
        check("bridge_original_parent_abort_signal", signal.aborted, true);
        throw Error("Invented lost acknowledgement");
      },
      async release(input) {
        releaseCalls++;
        check("prewrite_SQL_release_only_after_own_native_cancel", trial.inspection().physicalBodies, 0);
        check("prewrite_SQL_release_only_original_ticket", input.ticket, prewriteReservation.ticket);
        return call("release_prewrite_invented", [quote(input.executionId), quote(input.ticket)]);
      },
      async resolve(input) { return resolve(input.ticket); },
    }, clock.token);
    check("bridge_owned_shared_coordinator_ready", trial.kind, "ready");
    const sharedKeys = { currentKey: randomUUID(), previousKey: randomUUID(), epoch: Math.floor(fixture.receivedAtMs / limits.addressWindowMs) };
    let pulled = false, finishCancel;
    const cancelParent = new AbortController();
    const stalled = new Request("https://example.org/INVENTED_ONLY", { method: "POST", duplex: "half",
      headers: { "content-type": "application/json" }, signal: cancelParent.signal,
      body: new ReadableStream({ pull() { pulled = true; return new Promise(() => {}); },
        cancel() { return new Promise(resolve => { finishCancel = resolve; }); } }, { highWaterMark: 0 }) });
    const cancelled = trial.begin(stalled, sharedKeys, current);
    check("prewrite_original_native_body_unread_at_begin", stalled.bodyUsed, false);
    await wait(() => pulled); cancelParent.abort();
    check("prewrite_native_observer_held", await cancelled.observation, { kind: "held" });
    check("prewrite_original_physical_cancel_owned", trial.inspection().physicalBodies, 1);
    check("prewrite_actual_body_lease_retained_during_cancel", trial.inspection().ownedBodyLeases, 1);
    check("prewrite_native_cancel_cannot_retire_SQL", await trial.retirePrewrite(cancelled.token), { kind: "held" });
    check("prewrite_no_release_during_physical_cancel", releaseCalls, 0);
    check("prewrite_SQL_reservation_still_owned", (await counts()).reserved, 1);
    finishCancel(); await wait(() => trial.inspection().physicalBodies === 0);
    check("prewrite_explicit_own_retirement_then_SQL_release", await trial.retirePrewrite(cancelled.token), { kind: "released_prewrite_invented" });
    check("prewrite_SQL_reservation_gone_after_own_retirement", (await counts()).reserved, 0);
    check("prewrite_no_new_accepted_effect", (await counts()).acceptedInHour, 0);
    check("prewrite_known_factory_capacity_reusable", trial.inspection().owned, 0);
    check("prewrite_actual_body_lease_removed_after_own_retirement", trial.inspection().ownedBodyLeases, 0);
    const submission = trial.begin(incoming, sharedKeys, current);
    check("bridge_submission_owned_before_port", submission.kind, "owned_invented_submission");
    check("bridge_opaque_submission_no_body", JSON.stringify(submission.token).includes("CANARY"), false);
    await portStarted; parent.abort();
    check("bridge_parent_observation_held", await submission.observation, { kind: "held" });
    check("bridge_physical_SQL_port_still_owned", trial.inspection().physicalPorts, 1);
    check("bridge_A_physical_write_still_owned", trial.inspection().physicalWrites, 1);
    check("bridge_I_original_body_retired", trial.inspection().physicalBodies, 0);
    check("bridge_no_resolution_during_physical_write", await trial.resolveUnknown(submission.token), { kind: "held" });
    check("bridge_no_prewrite_release_during_physical_write", await trial.retirePrewrite(submission.token), { kind: "held" });
    await wait(() => trial.inspection().physicalWrites === 0);
    check("bridge_unknown_after_owned_physical_completion", trial.inspection().unknown, 1);
    check("bridge_one_durable_reservation_per_owned_request", reserveCalls, 2);
    check("bridge_one_physical_write_only", writeCalls, 1);
    check("bridge_never_prewrite_release_after_dispatch", releaseCalls, 1);
    check("bridge_shared_unknown_survives_process", (await counts()).unknown, 1);
    check("bridge_shared_effect_not_yet_settled", (await counts()).acceptedInHour, 0);
    const blocked = request(packet());
    check("bridge_local_unknown_holds_before_body", trial.begin(blocked, {}, current), { kind: "held" });
    check("bridge_local_unknown_body_unread", blocked.bodyUsed, false);
    check("bridge_external_shared_unknown_holds_before_body", await begin(), { kind: "held" });
    check("bridge_private_original_body_in_custody", Number((await sql("select count(*) from tf_contact_free_trial.payloads;")).trim()), 1);
    // Inspect I inside this actual facade; an unused owner proves nothing.
    check("bridge_actual_owned_body_leases_retired", trial.inspection().ownedBodyLeases, 0);
    check("bridge_actual_prepared_handoffs_claimed", trial.inspection().preparedBodyHandoffs, 0);
    retainedTicket = reservation.ticket;
  }
  check("shared_physical_commands_retired", physical, 0);
  check("shared_no_staging_records", Number((await sql("select count(*) from tf_bound_trial.records;")).trim()), 0);
  check("shared_no_staging_payloads", Number((await sql("select count(*) from tf_bound_trial.payloads;")).trim()), 0);
  completed = true;
}
try { await main(); } catch { process.exitCode = 1; }
process.stdout.write(JSON.stringify({ schemaVersion: 1, evidenceKind: "invented_native_shared_write_chain",
  phase: phase ?? null, completed, failureLabel: failLabel, assertions, commands, ticket: retainedTicket,
  proofOwnerVerified, primaryDatabaseTouched: false, actualSourceRequests: 0, liveIntakeEnabled: false,
  hostAuthenticationVerified: false, actualServiceRestartVerified: false }) + "\n");
