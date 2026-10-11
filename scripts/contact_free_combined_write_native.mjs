// Invented native-body/shared-admission proof; fixed fresh-cluster driver only.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { checkInventedNodeFixture } from "./contact_free_node_fixture.mjs";
import { createInventedContactFreeClock, observeInventedContactFreeClock } from "../src/invented-contact-free-clock.ts";
import { createInventedContactFreeBodyHandoff } from "../src/invented-contact-free-body-handoff.ts";
import { createInventedContactFreeWriteTrial } from "../src/invented-contact-free-write-trial.ts";
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
  const owner = createInventedContactFreeBodyHandoff(clock.token);
  if (owner.kind !== "ready") throw Error("Invented body owner held");
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
    check("replacement_owner_unused", owner.inspection().ownedLeases, 0);
    const result = await resolve(input.ticket);
    check("replacement_original_effect", result.outcome, "confirmed");
    check("replacement_original_received", result.result.lifecycle.receivedAtMs, fixture.receivedAtMs);
    check("replacement_original_effect_not_replayed", result.result.replayed, false);
    check("replacement_metadata_no_body", JSON.stringify(result).includes("CANARY"), false);
    check("replacement_count_once", (await counts()).acceptedInHour, 1);
    check("replacement_no_unknown", (await counts()).unknown, 0);
    check("replacement_no_second_resolution", await resolve(input.ticket), { kind: "held" });
  } else {
    const original = packet(), parent = new AbortController();
    const incoming = new Request("https://example.org/INVENTED_ONLY", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(original), signal: parent.signal });
    const reservation = await begin();
    check("chain_shared_reserved_first", reservation.kind, "reserved_invented");
    check("chain_original_body_unread", incoming.bodyUsed, false);
    const body = owner.begin(incoming, current, { kind: "invented_shared_admission", executionId: fixture.executionId,
      operationId: reservation.operationId, admittedAtMs: reservation.admittedAtMs });
    check("chain_body_owned", body.kind, "owned_invented_handoff");
    const prepared = await body.observation;
    check("chain_body_prepared", prepared.kind, "prepared_invented_handoff");
    check("chain_body_retired_before_write", owner.inspection().ownedLeases, 0);
    check("chain_original_body_consumed_once", incoming.bodyUsed, true);
    check("chain_opaque_handoff_has_no_body", JSON.stringify(prepared).includes("CANARY"), false);
    let calls = 0, committed = null, startPort;
    const portStarted = new Promise(resolve => { startPort = resolve; });
    const trial = createInventedContactFreeWriteTrial(
      { kind: "fresh_invented_trial", openReports: 0, acceptedAtMs: [] }, {
        executionId: fixture.executionId, nextOperationId: () => { throw Error("Original issued operation must be reused"); },
        async write(input, signal) {
          calls++;
          check("chain_original_operation_bound", input.operationId, reservation.operationId);
          check("chain_original_admission_bound", input.admittedAtMs, reservation.admittedAtMs);
          check("chain_original_request_bound", input.request, original);
          check("chain_sql_arm_after_body_retirement", (await arm(reservation, input.request)).kind, "armed_invented");
          // A owns a real child SQL command. Parent abort never kills it.
          const pending = value("begin;select pg_sleep(0.35);select " + shared + "write_invented(" +
            [quote(fixture.executionId), quote(reservation.ticket), quote(JSON.stringify(input.request)) + "::jsonb"].join(",") + ");commit;", "tf_shared_writer");
          startPort();
          committed = await pending;
          check("chain_actual_sql_commit", committed.outcome, "confirmed");
          check("chain_parent_cancel_signal_observed", signal.aborted, true);
          throw Error("Invented lost acknowledgement");
        },
        async recover() { throw Error("Only separate E metadata recovery is permitted"); },
      }, clock.token);
    check("chain_A_observer_ready", trial.kind, "ready");
    const observed = trial.submitPreparedForTrial(prepared.token, { currentKey: randomUUID(), previousKey: randomUUID(),
      epoch: Math.floor(fixture.receivedAtMs / limits.addressWindowMs) });
    await portStarted; parent.abort();
    check("chain_A_cancel_observation_held", await observed, { kind: "held" });
    check("chain_A_physical_write_still_owned", trial.inspection.operations().physical, 1);
    check("chain_A_no_recovery_while_physical", trial.recovery.pending(), []);
    check("chain_original_body_already_retired", owner.inspection().ownedLeases, 0);
    await wait(() => trial.inspection.operations().physical === 0);
    check("chain_A_unknown_after_physical_end", trial.inspection.budget().unknown, 1);
    check("chain_shared_unknown_after_commit", (await counts()).unknown, 1);
    check("chain_shared_effect_not_yet_settled", (await counts()).acceptedInHour, 0);
    check("chain_one_physical_write_only", calls, 1);
    check("chain_handoff_cannot_replay", await trial.submitPreparedForTrial(prepared.token, {}), { kind: "held" });
    check("chain_handoff_packet_retired", owner.inspection().preparedHandoffs, 0);
    check("chain_A_metadata_ticket_only", trial.recovery.pending().length, 1);
    const blocked = request(packet());
    check("chain_shared_blocks_before_second_body", await begin(), { kind: "held" });
    check("chain_second_body_unread", blocked.bodyUsed, false);
    check("chain_private_custody_one_body", Number((await sql("select count(*) from tf_contact_free_trial.payloads;")).trim()), 1);
    retainedTicket = reservation.ticket;
  }
  check("ownership_all_body_leases_retired", owner.inspection().ownedLeases, 0);
  check("shared_physical_commands_retired", physical, 0);
  check("shared_no_staging_records", Number((await sql("select count(*) from tf_bound_trial.records;")).trim()), 0);
  check("shared_no_staging_payloads", Number((await sql("select count(*) from tf_bound_trial.payloads;")).trim()), 0);
  completed = true;
}
try { await main(); } catch { process.exitCode = 1; }
process.stdout.write(JSON.stringify({ schemaVersion: 1, evidenceKind: "invented_native_combined_write_chain",
  phase: phase ?? null, completed, failureLabel: failLabel, assertions, commands, ticket: retainedTicket,
  proofOwnerVerified, primaryDatabaseTouched: false, actualSourceRequests: 0, liveIntakeEnabled: false,
  hostAuthenticationVerified: false, actualServiceRestartVerified: false }) + "\n");
