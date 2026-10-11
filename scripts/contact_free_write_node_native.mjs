// Fixed invented native composition, invoked only by its new-cluster driver.
// No HTTP, TCP database, credentials, real report or service activation.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { checkInventedNodeFixture } from "./contact_free_node_fixture.mjs";
import { createInventedContactFreeClock } from "../src/invented-contact-free-clock.ts";
import { createInventedContactFreeWriteTrial } from "../src/invented-contact-free-write-trial.ts";
import { correctionTargetSchema, deriveCorrectionTarget } from "../src/correction-target.ts";
import { contactFreeCorrectionPolicy as limits } from "../src/contact-free-correction-policy.ts";
import { connectedInput } from "../tests/helpers/connected_reader_fixture.mjs";

const IMAGE = "sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453";
const BIN = "/nix/var/nix/profiles/default/bin/";
const assertions = [], commands = [];
let fixture, completed = false, failLabel = null, physical = 0;
let proofOwnerVerified = false, injectedAckLoss = false, parentCanceledWithPhysicalSql = false;
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
function writeQuery(input) {
  return "select tf_contact_free_write_trial.submit_invented(" + quote(input.executionId) + "," +
    quote(input.operationId) + "," + quote(JSON.stringify(input.request)) + "::jsonb," + input.admittedAtMs + ");";
}
function recoverQuery(input) {
  return "select tf_contact_free_write_trial.recover_invented(" + quote(input.executionId) + "," +
    quote(input.operationId) + "," + quote(input.requestId) + "," + quote(JSON.stringify(input.target)) + "::jsonb," + input.admittedAtMs + ");";
}
async function counts() {
  return value("select jsonb_build_object('records',(select count(*) from tf_contact_free_trial.records)," +
    "'payloads',(select count(*) from tf_contact_free_trial.payloads),'stageRecords',(select count(*) from tf_bound_trial.records)," +
    "'stagePayloads',(select count(*) from tf_bound_trial.payloads),'operations',(select count(*) from tf_contact_free_write_trial.operations));");
}
async function main() {
  if (process.argv.length !== 2) throw Error("Fixed fixture accepts no arguments");
  let raw = ""; for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 4096) throw Error("Fixture held"); }
  const parsed = checkInventedNodeFixture(JSON.parse(raw));
  if (parsed.kind !== "checked") throw Error("Invented fixture held");
  fixture = parsed.fixture;
  check("node_owned_container_name", fixture.container, "terrafracta_write_node_" + fixture.stamp.toLowerCase().replace("-", "_"));
  check("node_owned_new_mount_path", fixture.clusterPath, "/tmp/tf-write-node-native-" + fixture.stamp + "/cluster");
  const meta = JSON.parse(await command(["inspect", fixture.container, "--format",
    '{"image":{{json .Image}},"labels":{{json .Config.Labels}},"network":{{json .HostConfig.NetworkMode}},"ports":{{json .NetworkSettings.Ports}},"mounts":{{json .Mounts}}}']));
  check("node_exact_image", meta.image, IMAGE); check("node_exact_label", meta.labels, { "terrafracta.write-node-trial": fixture.stamp });
  check("node_network_none", meta.network, "none"); check("node_no_published_ports", meta.ports, {});
  check("node_only_owned_mount", meta.mounts.map(m => [m.Source, m.Destination]), [[fixture.clusterPath, "/trial"]]);
  proofOwnerVerified = true;
  let now = fixture.receivedAtMs;
  const { claimId: _claimId, ...issueIdentity } = fixture.target;
  const current = () => ({ kind: "issue", issue: { ...connectedInput().issue, ...issueIdentity } });
  check("node_fixture_current_target", deriveCorrectionTarget(current()).target, fixture.target);
  const packet = () => ({ schemaVersion: 1, requestId: randomUUID(), draft: { target: fixture.target,
    fields: { kind: "missing_context", details: "INVENTED_PRIVATE_CANARY blåbær 日本語", sourceUrl: "https://example.org/INVENTED_ONLY" } } });
  const request = (p, signal) => new Request("https://example.org/INVENTED_ONLY", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify(p), signal });
  const keys = () => { const epoch = Math.floor(now / limits.addressWindowMs); return {
    currentKey: `c9700000-0000-4000-8000-${String(epoch).padStart(12, "0")}`,
    previousKey: `c9700000-0000-4000-8000-${String(epoch - 1).padStart(12, "0")}`, epoch }; };
  async function setup(label, override = {}) {
    const observed = await counts(), inputs = [], recoveryInputs = [];
    const ports = { executionId: fixture.executionId, nextOperationId: randomUUID,
      write: async (input, signal) => { inputs.push(input); return override.write ? override.write(input, signal) : value(writeQuery(input), "tf_trial_writer"); },
      recover: async (input, signal) => { recoveryInputs.push(input); return override.recover ? override.recover(input, signal) : value(recoverQuery(input), "tf_write_recovery"); } };
    // Trusted invented inventory only. No host continuity/authentication is inferred.
    const clock = createInventedContactFreeClock({ kind: "fresh_invented_clock", utcAtMs: now });
    if (clock.kind !== "ready") throw Error("Invented clock held");
    const trial = createInventedContactFreeWriteTrial({ kind: "fresh_invented_trial", openReports: observed.records,
      acceptedAtMs: [] }, ports, clock.token);
    check("node_trial_ready_" + label, trial.kind, "ready");
    return { trial, inputs, recoveryInputs, clock };
  }
  async function waitFor(predicate) {
    const until = performance.now() + 1000;
    while (!predicate()) { if (performance.now() >= until) throw Error("Owned observation held"); await flush(); }
  }
  async function noStage(label) { const c = await counts(); check(label + "_stage_records", c.stageRecords, 0); check(label + "_stage_payloads", c.stagePayloads, 0); }

  const firstPacket = packet(), normal = await setup("normal");
  const first = await normal.trial.submit(request(firstPacket), keys(), current);
  check("node_native_request_sql_confirmed", first.kind, "recorded_invented");
  check("node_normal_budget_counted_once", normal.trial.inspection.budget().acceptedInHour, 1);
  check("node_normal_open_count_matches_custody", normal.trial.inspection.budget().openReports, (await counts()).records);
  check("node_receipt_excludes_private_text", JSON.stringify(first).includes("CANARY"), false);
  check("node_write_original_admission", normal.inputs[0].admittedAtMs, now); await noStage("node_normal");

  const repeat = await normal.trial.submit(request(firstPacket), keys(), current);
  check("node_repeated_request_confirmed", repeat.kind, "recorded_invented"); check("node_repeated_request_original_report", repeat.receipt.reportId, first.receipt.reportId);
  check("node_repeated_effect_not_new_count", normal.trial.inspection.budget().acceptedInHour, 1);
  check("node_repeated_effect_one_custody", (await counts()).records, 1); await noStage("node_repeat");

  const lostPacket = packet(); let lost;
  lost = await setup("lost", { write: async input => { await value(writeQuery(input), "tf_trial_writer"); injectedAckLoss = true; throw Error("Invented lost acknowledgement"); } });
  check("node_injected_commit_ack_loss_is_held", await lost.trial.submit(request(lostPacket), keys(), current), { kind: "held" });
  check("node_ack_loss_actual_record_committed", (await counts()).records, 2); check("node_ack_loss_quota_unknown", lost.trial.inspection.budget().unknown, 1);
  const unread = request(packet()); check("node_ack_loss_new_body_held", await lost.trial.submit(unread, keys(), current), { kind: "held" }); check("node_ack_loss_body_remains_unread", unread.bodyUsed, false);
  const [lostTicket] = lost.trial.recovery.pending(); check("node_ack_loss_recovery_confirmed", (await lost.trial.recovery.recover(lostTicket)).kind, "resolved_invented");
  check("node_ack_loss_no_write_retry", lost.inputs.length, 1); check("node_ack_loss_one_recovery", lost.recoveryInputs.length, 1);
  check("node_ack_loss_recovery_metadata_only", Object.keys(lost.recoveryInputs[0]).sort(), ["admittedAtMs", "executionId", "operationId", "requestId", "target"]);
  check("node_ack_loss_original_effect_counted_once", lost.trial.inspection.budget().acceptedInHour, 1);
  check("node_ack_loss_actual_custody_unchanged", (await counts()).records, 2); await noStage("node_ack_loss");

  // Parent observation cancellation deliberately does not kill the child SQL
  // port. The actual transaction remains underway through a server-side delay.
  const canceledPacket = packet(), controller = new AbortController(); let entered = false;
  const canceled = await setup("canceled", { write: async input => {
    entered = true; const output = await sql(writeQuery(input) + "select pg_sleep(0.5);", "tf_trial_writer");
    return JSON.parse(output.trim().split("\n")[0]);
  } });
  const pending = canceled.trial.submit(request(canceledPacket, controller.signal), keys(), current);
  await waitFor(() => entered); controller.abort(); check("node_parent_abort_held", await pending, { kind: "held" });
  check("node_parent_abort_physical_owned", canceled.trial.inspection.operations().physical, 1);
  parentCanceledWithPhysicalSql = true;
  check("node_parent_abort_unknown_quota", canceled.trial.inspection.budget().unknown, 1);
  check("node_parent_abort_recovery_waits_physical", canceled.trial.recovery.pending(), []);
  await waitFor(() => canceled.trial.inspection.operations().physical === 0);
  check("node_late_sql_success_does_not_settle", canceled.trial.inspection.budget().unknown, 1);
  const [cancelTicket] = canceled.trial.recovery.pending(); check("node_cancel_explicit_recovery", (await canceled.trial.recovery.recover(cancelTicket)).kind, "resolved_invented");
  check("node_cancel_original_write_only", canceled.inputs.length, 1); check("node_cancel_actual_custody", (await counts()).records, 3); await noStage("node_cancel");

  const absentPacket = packet(), absent = await setup("absent", { write: async () => { throw Error("Invented pre-SQL failure"); } });
  check("node_missing_ack_before_sql_held", await absent.trial.submit(request(absentPacket), keys(), current), { kind: "held" });
  const [absentTicket] = absent.trial.recovery.pending(); check("node_absence_fence_resolves_nonwrite", (await absent.trial.recovery.recover(absentTicket)).kind, "resolved_invented");
  check("node_absence_fence_quota_released", absent.trial.inspection.budget().reserved, 0); check("node_absence_fence_not_counted", absent.trial.inspection.budget().acceptedInHour, 0);
  check("node_late_server_write_blocked_by_fence", (await value(writeQuery(absent.inputs[0]), "tf_trial_writer")).outcome, "known_nonwrite");
  check("node_absence_fence_no_report", (await counts()).records, 3); await noStage("node_absence");

  const stale = await setup("stale"); await sql("update tf_bound_trial.current_targets set eligible_for_invented_trial=false;");
  check("node_native_eof_cannot_override_retired_sql_target", await stale.trial.submit(request(packet()), keys(), current), { kind: "held" });
  check("node_retired_target_known_nonwrite_released", stale.trial.inspection.budget().reserved, 0);
  check("node_retired_target_no_new_count", stale.trial.inspection.budget().acceptedInHour, 0); check("node_retired_target_no_custody", (await counts()).records, 3); await noStage("node_retired");
  await sql("update tf_bound_trial.current_targets set eligible_for_invented_trial=true;");

  const retainedPacket = packet(), retained = await setup("retained", { write: async input => { await value(writeQuery(input), "tf_trial_writer"); throw Error("Invented delayed unknown observation"); } });
  await retained.trial.submit(request(retainedPacket), keys(), current); const [retainedTicket] = retained.trial.recovery.pending();
  const original = retained.inputs[0], originalObservation = await value(recoverQuery({ ...original, requestId: original.request.requestId, target: original.request.draft.target }), "tf_write_recovery");
  now += 10 * 86400000; await sql(`begin;update tf_contact_free_trial.clock_state set now_ms=${now};update tf_bound_trial.clock_state set now_ms=${now};commit;`);
  check("node_actual_closure", (await value("select tf_contact_free_trial.close_private(" + quote(originalObservation.result.reportId) + ",'corrected','INVENTED resolution');", "tf_trial_reviewer")).kind, "closed_private");
  now += 30 * 86400000; retained.clock.advanceForTrial({ utcAtMs: now }); await sql(`begin;update tf_contact_free_trial.clock_state set now_ms=${now};update tf_bound_trial.clock_state set now_ms=${now};commit;`);
  check("node_actual_close_bound_payload_removed", (await value("select tf_contact_free_trial.sweep_private();", "tf_trial_custodian")).removedPayloads, 1);
  check("node_closed_payload_recovery_original_effect", (await retained.trial.recovery.recover(retainedTicket)).kind, "resolved_invented");
  check("node_closed_recovery_original_admission", retained.recoveryInputs[0].admittedAtMs, fixture.receivedAtMs);
  check("node_closed_recovery_keeps_payload_deleted", (await counts()).payloads, 3); await noStage("node_closed");
  const recovered = await value(recoverQuery(retained.recoveryInputs[0]), "tf_write_recovery");
  check("node_closed_original_received_not_renewed", recovered.result.lifecycle.receivedAtMs, fixture.receivedAtMs);
  check("node_closed_recovery_has_no_payload", recovered.result.payloadAvailable, false);
  now = fixture.receivedAtMs + limits.recordLifetimeMs;
  await sql(`begin;update tf_contact_free_trial.clock_state set now_ms=${now};update tf_bound_trial.clock_state set now_ms=${now};commit;`);
  check("node_original_metadata_deadline_holds", (await value(recoverQuery(retained.recoveryInputs[0]), "tf_write_recovery")).outcome, "unknown");
  check("node_actual_operation_expiry", (await value("select tf_contact_free_write_trial.expire_operations();", "tf_trial_custodian")).removed > 0, true);
  check("node_actual_custody_record_expiry", (await value("select tf_contact_free_trial.sweep_private();", "tf_trial_custodian")).removedRecords, 4);
  check("node_final_private_counts", await counts(), { records: 0, payloads: 0, stageRecords: 0, stagePayloads: 0, operations: 0 });
  check("node_all_physical_commands_retired", physical, 0); completed = true;
}
try { await main(); } catch { process.exitCode = 1; }
const result = { schemaVersion: 1, evidenceKind: "invented_native_request_admission_sql_recovery", completed,
  failureLabel: failLabel, assertions, commands, injectedAckLoss, parentCanceledWithPhysicalSql,
  primaryDatabaseTouched: false, actualSourceRequests: 0, liveIntakeEnabled: false, hostAuthenticationVerified: false };
if (proofOwnerVerified) await writeFile(fixture.clusterPath.slice(0, -8) + "/NODE_RESULT.json", JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
process.stdout.write(JSON.stringify(result) + "\n");
