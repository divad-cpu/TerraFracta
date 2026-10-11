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
// Neither process receives the lost original admission ticket. Replacement
// observes debt through the separately authorized G inventory only.
const inputSchema = z.strictObject({ fixture: z.unknown(), phase: z.enum(["first", "replacement"]), ticket: z.null() });
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
    const before = await counts();
    check("begin_replacement_original_pending_debt", before.reserved, 1);
    check("begin_replacement_no_invented_write_effect", before.acceptedInHour, 0);
    const original = await value("select tf_shared_inventory_trial.capture_invented(" + quote(fixture.executionId) + ");", "tf_shared_inventory");
    check("begin_replacement_empty_custody", original.writeInventory.records, []);
    check("begin_replacement_empty_effect_ledger", original.writeInventory.operations, []);
    check("begin_replacement_original_reserved_phase", original.admission.reservations[0].phase, "reserved");
    const untouched = request(packet()), ownUnused = await begin();
    check("begin_replacement_only_second_shared_slot", ownUnused.kind, "reserved_invented");
    check("begin_replacement_own_body_never_read", untouched.bodyUsed, false);
    check("begin_replacement_no_third_shared_slot", await begin(), { kind: "held" });
    check("begin_replacement_release_only_own_unused_slot", await release(ownUnused), { kind: "released_invented" });
    check("begin_replacement_original_debt_not_cleared", (await counts()).reserved, 1);
    check("begin_replacement_held_global_open_and_hour", (await counts()).acceptedInHour, 0);
  } else {
    const incoming = request(packet());
    let reserveCalls=0,armCalls=0,writeCalls=0,releaseCalls=0,resolveCalls=0;
    const trial=createInventedContactFreeSharedWriteTrial({executionId:fixture.executionId,
      async reserve(input,signal) {
        reserveCalls++;
        check("begin_actual_SQL_reserve_before_original_body",incoming.bodyUsed,false);
        const result=await call("begin_invented",[quote(input.executionId),quote(input.operationId),quote(input.currentKey),quote(input.previousKey),input.epoch]);
        check("begin_actual_SQL_reserved_original_operation",result.operationId,input.operationId);
        check("begin_actual_SQL_committed_before_ack_loss",result.kind,"reserved_invented");
        throw Error("Invented lost admission acknowledgement");
      },async arm(){armCalls++;throw Error("No body authority");},async write(){writeCalls++;throw Error("No body authority");},
      async release(){releaseCalls++;throw Error("Unknown admission cannot be released");},
      async resolve(){resolveCalls++;throw Error("No original write identity");},
    },clock.token);
    check("begin_owned_coordinator_ready",trial.kind,"ready");
    const submission=trial.begin(incoming,{currentKey:randomUUID(),previousKey:randomUUID(),epoch:Math.floor(fixture.receivedAtMs/limits.addressWindowMs)},current);
    check("begin_opaque_submission_owned",submission.kind,"owned_invented_submission");
    check("begin_lost_admission_observation_held",await submission.observation,{kind:"held"});
    check("begin_original_body_remains_unread",incoming.bodyUsed,false);
    check("begin_physical_admission_port_ended",trial.inspection().physicalPorts,0);
    check("begin_no_physical_body_started",trial.inspection().physicalBodies,0);
    check("begin_actual_body_lease_never_started",trial.inspection().ownedBodyLeases,0);
    check("begin_actual_prepared_handoff_never_issued",trial.inspection().preparedBodyHandoffs,0);
    check("begin_no_physical_write_started",trial.inspection().physicalWrites,0);
    check("begin_unknown_local_debt_retained",trial.inspection().unknown,1);
    check("begin_one_reserve_call_no_retry",reserveCalls,1);
    check("begin_no_arm_call",armCalls,0);check("begin_no_write_call",writeCalls,0);
    check("begin_no_unknown_prewrite_release",await trial.retirePrewrite(submission.token),{kind:"held"});
    check("begin_no_unknown_write_resolution",await trial.resolveUnknown(submission.token),{kind:"held"});
    check("begin_no_release_port_call",releaseCalls,0);check("begin_no_resolution_port_call",resolveCalls,0);
    const blocked=request(packet());
    check("begin_unknown_same_factory_held",trial.begin(blocked,{},current),{kind:"held"});
    check("begin_blocked_body_unread",blocked.bodyUsed,false);
    check("begin_durable_reserved_after_lost_ack",(await counts()).reserved,1);
    check("begin_no_durable_accepted_effect",(await counts()).acceptedInHour,0);
    // The caller never receives the SQL ticket hidden by the lost reply.
    // Only the parent's separately captured G inventory later contains it.
  }
  check("shared_physical_commands_retired", physical, 0);
  check("shared_no_staging_records", Number((await sql("select count(*) from tf_bound_trial.records;")).trim()), 0);
  check("shared_no_staging_payloads", Number((await sql("select count(*) from tf_bound_trial.payloads;")).trim()), 0);
  completed = true;
}
try { await main(); } catch { process.exitCode = 1; }
process.stdout.write(JSON.stringify({ schemaVersion: 1, evidenceKind: "invented_native_shared_begin_ack_loss",
  phase: phase ?? null, completed, failureLabel: failLabel, assertions, commands, ticket: retainedTicket,
  proofOwnerVerified, primaryDatabaseTouched: false, actualSourceRequests: 0, liveIntakeEnabled: false,
  hostAuthenticationVerified: false, actualServiceRestartVerified: false }) + "\n");
