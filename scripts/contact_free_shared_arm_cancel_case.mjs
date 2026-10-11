// A separate explicitly invented operation; shared SQL continuity is reused.
// Its held factory is never revived or used as host/restart admission authority.
import { randomUUID } from "node:crypto";
import { createInventedContactFreeSharedWriteTrial } from "../src/invented-contact-free-shared-write-trial.ts";
import { contactFreeCorrectionPolicy as limits } from "../src/contact-free-correction-policy.ts";
export async function proveInventedSharedArmCancellation(ctx) {
  const { check, call, value, counts, fixture, clock, current, packet, wait, quote, sql } = ctx;
  const parent = new AbortController(), original = packet();
  const incoming = new Request("https://example.org/INVENTED_ONLY", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify(original), signal: parent.signal });
  let reservation, armCalled = false, physicalArmEnded = false, writeCalls = 0, releaseCalls = 0, resolveCalls = 0;
  const trial = createInventedContactFreeSharedWriteTrial({ executionId: fixture.executionId,
    async reserve(input) {
      check("armgap_reserve_before_original_body", incoming.bodyUsed, false);
      reservation = await call("begin_invented", [quote(input.executionId), quote(input.operationId),
        quote(input.currentKey), quote(input.previousKey), input.epoch]);
      check("armgap_original_operation_issued", reservation.operationId, input.operationId);
      return reservation;
    },
    async arm(input, signal) {
      check("armgap_body_consumed_once_before_arm", incoming.bodyUsed, true);
      check("armgap_original_ticket_and_request", [input.ticket, input.requestId], [reservation.ticket, original.requestId]);
      // Actual owned child/transaction remains outstanding across parent abort.
      const pending = value("begin;select pg_sleep(0.35);select tf_shared_admission_trial.arm_invented(" +
        [quote(input.executionId), quote(input.ticket), quote(input.requestId), quote(JSON.stringify(input.target)) + "::jsonb"].join(",") + ");commit;", "tf_shared_writer");
      armCalled = true; const result = await pending; physicalArmEnded = true;
      check("armgap_SQL_committed_original_arm", result.kind, "armed_invented");
      check("armgap_parent_cancel_signal_preserved", signal.aborted, true);
      return result;
    },
    async write() { writeCalls++; throw Error("Cancelled arm must never dispatch write"); },
    async release() { releaseCalls++; throw Error("Armed debt cannot release prewrite"); },
    async resolve(input) {
      resolveCalls++;
      check("armgap_resolution_minimal_original_metadata", Object.keys(input).sort(), ["executionId", "ticket"]);
      check("armgap_resolution_owns_original_ticket", input.ticket, reservation.ticket);
      const result = await call("resolve_invented", [quote(input.executionId), quote(input.ticket)], "tf_shared_recovery");
      check("armgap_actual_original_nonwrite_fence", result.outcome, "known_nonwrite");
      check("armgap_nonwrite_has_no_body_or_receipt", result.result, null);
      return result;
    },
  }, clock.token);
  check("armgap_owned_coordinator_ready", trial.kind, "ready");
  const submission = trial.begin(incoming, { currentKey: randomUUID(), previousKey: randomUUID(),
    epoch: Math.floor(fixture.receivedAtMs / limits.addressWindowMs) }, current);
  check("armgap_original_submission_owned", submission.kind, "owned_invented_submission");
  await wait(() => armCalled); parent.abort();
  check("armgap_cancelled_observation_held", await submission.observation, { kind: "held" });
  check("armgap_physical_arm_still_owned", trial.inspection().physicalPorts, 1);
  check("armgap_A_observation_physical_owned", trial.inspection().physicalWrites, 1);
  check("armgap_no_resolution_during_physical_arm", await trial.resolveUnknown(submission.token), { kind: "held" });
  check("armgap_no_prewrite_release_during_arm", await trial.retirePrewrite(submission.token), { kind: "held" });
  await wait(() => physicalArmEnded && trial.inspection().physicalWrites === 0);
  check("armgap_original_SQL_debt_retained", (await counts()).unknown, 1);
  check("armgap_no_write_after_physical_arm", writeCalls, 0);
  check("armgap_no_prewrite_release_after_arm", releaseCalls, 0);
  check("armgap_nonwrite_resolution_remains_nonacceptance", await trial.resolveUnknown(submission.token), { kind: "held" });
  check("armgap_one_original_resolution_only", resolveCalls, 1);
  check("armgap_nonwrite_fence_releases_SQL_debt", (await counts()).reserved, 0);
  check("armgap_nonwrite_never_counts_accepted", (await counts()).acceptedInHour, 0);
  check("armgap_factory_permanently_held_after_resolution", trial.inspection().held, true);
  check("armgap_resolved_original_cannot_repeat", await trial.resolveUnknown(submission.token), { kind: "held" });
  check("armgap_zero_private_custody", Number((await sql("select count(*) from tf_contact_free_trial.records;")).trim()), 0);
  check("armgap_original_nonwrite_effect_preserved", Number((await sql("select count(*) from tf_contact_free_write_trial.operations where state='nonwrite';")).trim()), 1);
}

// Captured native deadline retires only observation. A late real SQL reply can
// authorize explicit own prewrite retirement after its physical child ends.
export async function proveInventedSharedReserveTimeout(ctx) {
  const { check, call, value, counts, fixture, clock, current, packet, wait, quote } = ctx;
  const incoming = new Request("https://example.org/INVENTED_ONLY", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify(packet()) });
  let reservation, physicalReserveEnded = false, releaseCalls = 0, writeCalls = 0;
  const trial = createInventedContactFreeSharedWriteTrial({ executionId: fixture.executionId,
    async reserve(input) {
      // This is an actual native child/transaction, not a fake injected timer.
      reservation = await value("begin;select pg_sleep(2.15);select tf_shared_admission_trial.begin_invented(" +
        [quote(input.executionId), quote(input.operationId), quote(input.currentKey), quote(input.previousKey), input.epoch].join(",") + ");commit;", "tf_shared_writer");
      physicalReserveEnded = true;
      check("reservegap_late_actual_SQL_admission", reservation.kind, "reserved_invented");
      return reservation;
    },
    async arm() { throw Error("Timed-out admission must not read/arm body"); },
    async write() { writeCalls++; throw Error("Timed-out admission must not write body"); },
    async release(input) {
      releaseCalls++;
      check("reservegap_release_only_after_physical_end", physicalReserveEnded, true);
      check("reservegap_release_exact_late_original_ticket", input.ticket, reservation.ticket);
      return call("release_prewrite_invented", [quote(input.executionId), quote(input.ticket)]);
    },
    async resolve() { throw Error("Never armed admission is not a write-resolution ticket"); },
  }, clock.token);
  check("reservegap_owned_coordinator_ready", trial.kind, "ready");
  const started = performance.now();
  const submission = trial.begin(incoming, { currentKey: randomUUID(), previousKey: randomUUID(),
    epoch: Math.floor(fixture.receivedAtMs / limits.addressWindowMs) }, current);
  check("reservegap_observer_deadline_held", await submission.observation, { kind: "held" });
  check("reservegap_actual_native_deadline_elapsed", performance.now() - started >= 1_900, true);
  check("reservegap_body_unread_at_observer_timeout", incoming.bodyUsed, false);
  check("reservegap_physical_reserve_still_owned", trial.inspection().physicalPorts, 1);
  check("reservegap_no_release_while_physical_port", await trial.retirePrewrite(submission.token), { kind: "held" });
  check("reservegap_no_release_port_during_physical", releaseCalls, 0);
  await wait(() => physicalReserveEnded && trial.inspection().physicalPorts === 0);
  check("reservegap_body_unread_after_late_reply", incoming.bodyUsed, false);
  check("reservegap_explicit_late_own_prewrite_retirement", await trial.retirePrewrite(submission.token), { kind: "released_prewrite_invented" });
  check("reservegap_one_original_release_only", releaseCalls, 1);
  check("reservegap_no_body_write", writeCalls, 0);
  check("reservegap_SQL_debt_removed_only_after_release", (await counts()).reserved, 0);
  check("reservegap_no_accepted_effect", (await counts()).acceptedInHour, 0);
  check("reservegap_own_factory_retired_without_restart", trial.inspection().owned, 0);
}
