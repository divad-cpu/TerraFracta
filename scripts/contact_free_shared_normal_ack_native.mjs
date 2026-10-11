import {proveInventedSharedConfirmedReplay} from './contact_free_shared_confirmed_replay_case.mjs';
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

  if (phase === "replacement") {
    check("normal_replacement_durable_unknown", (await counts()).unknown, 1);
    const unread = request(packet());
    check("normal_replacement_prebody_held", await begin(), {kind:"held"});
    check("normal_replacement_body_unread", unread.bodyUsed, false);
    const result = await resolve(input.ticket);
    check("normal_replacement_original_confirmed", result.outcome, "confirmed");
    check("normal_replacement_original_received", result.result.lifecycle.receivedAtMs, fixture.receivedAtMs);
    check("normal_replacement_no_replay", result.result.replayed, false);
    check("normal_replacement_metadata_no_body", JSON.stringify(result).includes("CANARY"), false);
    check("normal_replacement_count_once", [(await counts()).acceptedInHour,(await counts()).openReports], [1,1]);
    check("normal_replacement_no_debt", [(await counts()).unknown,(await counts()).reserved], [0,0]);
    check("normal_replacement_no_second_resolution", await resolve(input.ticket), {kind:"held"});
    check("normal_replacement_one_original_custody", Number((await sql("select count(*) from tf_contact_free_trial.records;")).trim()), 1);
    await proveInventedSharedConfirmedReplay({check,call,counts,fixture,clock,current,packet,quote,sql,originalRequestId:result.result.requestId,originalReportId:result.result.reportId});
  } else {
    const original = packet(), incoming = request(original);
    let reservation, armCalls=0, writeCalls=0, releaseCalls=0, resolveCalls=0;
    const trial=createInventedContactFreeSharedWriteTrial({executionId:fixture.executionId,
      async reserve(input,signal) {
        check("normal_reserve_before_original_body",incoming.bodyUsed,false);
        check("normal_reserve_signal_active",signal.aborted,false);
        reservation=await call("begin_invented",[quote(input.executionId),quote(input.operationId),quote(input.currentKey),quote(input.previousKey),input.epoch]);
        check("normal_original_operation_issued",reservation.operationId,input.operationId);
        check("normal_original_admission_issued",reservation.admittedAtMs,fixture.receivedAtMs);
        return reservation;
      },
      async arm(input,signal) {
        armCalls++;
        check("normal_original_body_consumed_before_arm",incoming.bodyUsed,true);
        check("normal_arm_signal_active",signal.aborted,false);
        check("normal_original_ticket_and_request",[input.ticket,input.requestId],[reservation.ticket,original.requestId]);
        const result=await call("arm_invented",[quote(input.executionId),quote(input.ticket),quote(input.requestId),quote(JSON.stringify(input.target))+"::jsonb"]);
        check("normal_actual_SQL_armed",result.kind,"armed_invented");return result;
      },
      async write(input,signal) {
        writeCalls++;
        check("normal_write_exact_original_packet",input.request,original);
        check("normal_write_packet_frozen",Object.isFrozen(input.request),true);
        check("normal_write_exact_original_ticket",input.ticket,reservation.ticket);
        check("normal_write_signal_active",signal.aborted,false);
        const result=await call("write_invented",[quote(input.executionId),quote(input.ticket),quote(JSON.stringify(input.request))+"::jsonb"]);
        check("normal_actual_SQL_confirmed",result.outcome,"confirmed");
        check("normal_actual_SQL_original_request",result.result.requestId,original.requestId);
        check("normal_actual_SQL_original_admission",result.result.lifecycle.receivedAtMs,fixture.receivedAtMs);
        return result;
      },
      async release(){releaseCalls++;throw Error("Confirmed dispatch is not prewrite release");},
      async resolve(){resolveCalls++;throw Error("No automatic resolution in this worker");},
    },clock.token);
    check("normal_owned_coordinator_ready",trial.kind,"ready");
    const submission=trial.begin(incoming,{currentKey:randomUUID(),previousKey:randomUUID(),epoch:Math.floor(fixture.receivedAtMs/limits.addressWindowMs)},current);
    check("normal_original_submission_owned",submission.kind,"owned_invented_submission");
    const result=await submission.observation;
    check("normal_facade_delivers_recorded",result.kind,"recorded_invented");
    check("normal_receipt_has_no_private_body",JSON.stringify(result).includes("CANARY"),false);
    check("normal_receipt_original_request",result.receipt.requestId,original.requestId);
    check("normal_receipt_no_replay",result.receipt.replayed,false);
    check("normal_one_arm_write_only",[armCalls,writeCalls],[1,1]);
    check("normal_no_release_or_auto_resolution",[releaseCalls,resolveCalls],[0,0]);
    check("normal_physical_work_retired",[trial.inspection().physicalPorts,trial.inspection().physicalBodies,trial.inspection().physicalWrites],[0,0,0]);
    check("normal_shared_settlement_debt_retained",[trial.inspection().unknown,(await counts()).unknown],[1,1]);
    check("normal_unsettled_not_counted",[(await counts()).acceptedInHour,(await counts()).openReports],[0,1]);
    check("normal_one_original_private_body",Number((await sql("select count(*) from tf_contact_free_trial.payloads p join tf_contact_free_trial.records r using(report_id) where r.request_id="+quote(original.requestId)+";")).trim()),1);
    const unread=request(packet());
    check("normal_pending_settlement_blocks_next_body",trial.begin(unread,{},current),{kind:"held"});
    check("normal_blocked_next_body_unread",unread.bodyUsed,false);
    check("normal_dispatched_cannot_release_prewrite",await trial.retirePrewrite(submission.token),{kind:"held"});
    check("normal_no_release_after_retirement_attempt",releaseCalls,0);
    // Inspect I inside this actual facade; an unused owner proves nothing.
    check("normal_actual_owned_body_leases_retired", trial.inspection().ownedBodyLeases, 0);
    check("normal_actual_prepared_handoffs_claimed", trial.inspection().preparedBodyHandoffs, 0);
    retainedTicket=reservation.ticket;
  }
  check("shared_physical_commands_retired", physical, 0);
  check("shared_no_staging_records", Number((await sql("select count(*) from tf_bound_trial.records;")).trim()), 0);
  check("shared_no_staging_payloads", Number((await sql("select count(*) from tf_bound_trial.payloads;")).trim()), 0);
  completed = true;
}
try { await main(); } catch { process.exitCode = 1; }
process.stdout.write(JSON.stringify({ schemaVersion: 1, evidenceKind: "invented_native_shared_normal_ack_chain",
  phase: phase ?? null, completed, failureLabel: failLabel, assertions, commands, ticket: retainedTicket,
  proofOwnerVerified, primaryDatabaseTouched: false, actualSourceRequests: 0, liveIntakeEnabled: false,
  hostAuthenticationVerified: false, actualServiceRestartVerified: false }) + "\n");
