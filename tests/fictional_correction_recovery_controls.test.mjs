import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createFictionalCorrectionWorkflow } from "../src/fictional-correction-workflow.ts";
import { fictionalWorkflowFixture, workflowId } from "./helpers/fictional_correction_workflow_fixture.mjs";
import { elements } from "./helpers/correction_draft_harness.mjs";
import { loadTsx } from "./helpers/tsx_loader.mjs";

const View = loadTsx(new URL("../src/fictional-correction-workflow-view.tsx", import.meta.url)).FictionalCorrectionWorkflowView;
const tick = () => new Promise(resolve => setImmediate(resolve));
const actionsFor = workflow => ({ load: () => workflow.load(), preparePage: () => workflow.prepare("page", () => workflowId(4)),
  prepareStatement: () => workflow.prepare("statement", () => workflowId(4)), submit: () => workflow.submit(),
  queue: () => workflow.queue(), nextPage: () => workflow.queue(true), detail: () => workflow.detail(),
  startReview: () => workflow.review("in_review", () => workflowId(6)), closeReview: () => workflow.review("closed", () => workflowId(7)),
  recover: () => workflow.recover(), cancel: () => workflow.cancel() });
const treeFor = workflow => View({ state: workflow.snapshot(), actions: actionsFor(workflow) });
const htmlFor = workflow => renderToStaticMarkup(createElement(View, { state: workflow.snapshot(), actions: actionsFor(workflow) }));
function button(workflow, label) {
  const value = elements(treeFor(workflow)).find(item => item.type === "button" && item.props.children === label);
  assert.ok(value, label); return value;
}
async function click(workflow, label) {
  const value = button(workflow, label); assert.equal(value.props.disabled, false, label); return value.props.onClick();
}
function onlyRecoveryEnabled(workflow) {
  const controls = elements(treeFor(workflow)).filter(item => item.type === "button");
  assert.deepEqual(controls.filter(item => !item.props.disabled).map(item => item.props.children), ["Look up the uncertain review event"]);
}
async function uncertainReview(dependencies = {}) {
  const fixture = fictionalWorkflowFixture(), observations = [];
  const workflow = createFictionalCorrectionWorkflow(fixture.backend, { now: () => 0, onFault: () => {},
    onChange: state => observations.push(state), ...dependencies });
  await workflow.load(); workflow.prepare("statement", () => workflowId(4)); await workflow.submit();
  await workflow.queue(); await workflow.detail(); fixture.state.unknownReview = true;
  await workflow.review("in_review", () => workflowId(5));
  return { fixture, workflow, observations };
}

test("immutable snapshots distinguish owned write uncertainty from the last read's reason", async () => {
  const { workflow, observations } = await uncertainReview();
  assert.equal(workflow.snapshot().uncertainWrite, "review");
  assert.ok(observations.some(state => state.reason === "unknown_review" && state.uncertainWrite === "review"));
  assert.throws(() => { workflow.snapshot().uncertainWrite = null; });
  const fixture = fictionalWorkflowFixture(), intake = createFictionalCorrectionWorkflow(fixture.backend, { now: () => 0, onFault: () => {} });
  assert.equal(intake.snapshot().uncertainWrite, null);
  await intake.load(); intake.prepare("page", () => workflowId(4)); fixture.state.unknownIntake = true; await intake.submit();
  assert.equal(intake.snapshot().uncertainWrite, "intake");
  assert.ok(elements(treeFor(intake)).filter(item => item.type === "button").every(item => item.props.disabled));
  await intake.recover(); assert.ok(!fixture.calls.some(([operation]) => operation === "recover"));
});

test("actual presenter callbacks allow a failed read-only lookup to retry the same event with one write", async () => {
  const { fixture, workflow } = await uncertainReview(), original = fixture.backend.lookupReviewEvent;
  const request = structuredClone(workflow.snapshot().reviewRequest);
  fixture.backend.lookupReviewEvent = async input => { fixture.calls.push(["recover", structuredClone(input)]); throw Error("invented unavailable lookup"); };
  await click(workflow, "Look up the uncertain review event");
  assert.equal(workflow.snapshot().reason, "unavailable"); assert.equal(workflow.snapshot().uncertainWrite, "review");
  onlyRecoveryEnabled(workflow);
  assert.match(htmlFor(workflow), /Review outcome remains unknown/);
  const calls = fixture.calls.length;
  await workflow.queue(); await workflow.detail(); await workflow.submit(); await workflow.review("closed", () => assert.fail("no new write identity"));
  assert.equal(fixture.calls.length, calls);
  fixture.backend.lookupReviewEvent = original; await click(workflow, "Look up the uncertain review event");
  const state = workflow.snapshot();
  assert.equal(state.phase, "recovered"); assert.equal(state.uncertainWrite, null);
  assert.deepEqual(state.reviewRequest, request);
  assert.deepEqual(fixture.calls.filter(([operation]) => operation === "recover").map(([, input]) => input), [request, request]);
  assert.equal(fixture.calls.filter(([operation]) => operation === "review").length, 1);
  assert.equal(button(workflow, "Look up the uncertain review event").props.disabled, true);
  assert.equal(button(workflow, "Read a fresh queue snapshot").props.disabled, false);
});

test("unobserved recovery remains repeatable read-only; failed clock observations withhold its old body", async () => {
  for (const when of ["start", "finish"]) {
    let armed = false, reads = 0;
    const { fixture, workflow } = await uncertainReview({ now: () => {
      if (!armed) return 0;
      if (when === "start" || reads++ > 0) throw Error("invented clock failure");
      return 0;
    } });
    fixture.state.observed = false; await click(workflow, "Look up the uncertain review event");
    assert.equal(workflow.snapshot().reason, "not_observed"); assert.match(htmlFor(workflow), /Outcome: not observed/);
    await click(workflow, "Look up the uncertain review event");
    assert.equal(fixture.calls.filter(([operation]) => operation === "review").length, 1);
    armed = true; await click(workflow, "Look up the uncertain review event");
    assert.equal(workflow.snapshot().reason, "unavailable"); assert.equal(workflow.snapshot().uncertainWrite, "review");
    assert.ok(workflow.snapshot().recovery, "the earlier observation remains historical, not a new checked result");
    assert.doesNotMatch(htmlFor(workflow), /Outcome:|Separately observed review state:/);
    onlyRecoveryEnabled(workflow);
    armed = false; fixture.state.observed = true; await click(workflow, "Look up the uncertain review event");
    assert.equal(workflow.snapshot().phase, "recovered"); assert.equal(workflow.snapshot().uncertainWrite, null);
  }
});

test("cancelled recovery keeps the owned port locked until late settlement then permits one explicit read", async () => {
  for (const dispatched of [false, true]) for (const late of ["resolve", "reject"]) {
    const { fixture, workflow } = await uncertainReview(), original = fixture.backend.lookupReviewEvent;
    fixture.state.observed = false; await workflow.recover(); fixture.state.observed = true;
    let resolve, reject, calls = 0;
    fixture.backend.lookupReviewEvent = () => { calls++; return new Promise((r, j) => { resolve = r; reject = j; }); };
    const pending = click(workflow, "Look up the uncertain review event");
    if (dispatched) await tick();
    workflow.cancel(); await pending;
    assert.equal(workflow.snapshot().reason, "cancelled"); assert.equal(workflow.snapshot().uncertainWrite, "review");
    assert.doesNotMatch(htmlFor(workflow), /Outcome:|Separately observed review state:/);
    if (dispatched) {
      assert.equal(workflow.snapshot().busy, true); assert.equal(button(workflow, "Look up the uncertain review event").props.disabled, true);
      await workflow.recover(); assert.equal(calls, 1);
      if (late === "resolve") resolve(await original(workflow.snapshot().reviewRequest));
      else reject(Error("invented late rejection"));
    } else assert.equal(calls, 0);
    await tick(); assert.equal(workflow.snapshot().busy, false); assert.equal(workflow.snapshot().reason, "cancelled");
    onlyRecoveryEnabled(workflow);
    const count = fixture.calls.filter(([operation]) => operation === "recover").length;
    await tick(); assert.equal(fixture.calls.filter(([operation]) => operation === "recover").length, count, "no automatic retry");
    fixture.backend.lookupReviewEvent = original; await click(workflow, "Look up the uncertain review event");
    assert.equal(workflow.snapshot().phase, "recovered"); assert.equal(fixture.calls.filter(([operation]) => operation === "review").length, 1);
  }
});

test("owned deadline hides prior recovery and keeps controls locked until the actual port settles", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { fixture, workflow } = await uncertainReview(), original = fixture.backend.lookupReviewEvent;
  fixture.state.observed = false; await workflow.recover(); fixture.state.observed = true;
  let resolve; fixture.backend.lookupReviewEvent = () => new Promise(r => { resolve = r; });
  const pending = click(workflow, "Look up the uncertain review event"); await tick(); t.mock.timers.tick(3_000); await pending;
  assert.equal(workflow.snapshot().reason, "unavailable"); assert.equal(workflow.snapshot().busy, true);
  assert.doesNotMatch(htmlFor(workflow), /Outcome:|Separately observed review state:/);
  assert.equal(button(workflow, "Look up the uncertain review event").props.disabled, true);
  resolve(await original(workflow.snapshot().reviewRequest)); await tick();
  assert.equal(workflow.snapshot().reason, "unavailable"); onlyRecoveryEnabled(workflow);
  fixture.backend.lookupReviewEvent = original; await click(workflow, "Look up the uncertain review event");
  assert.equal(workflow.snapshot().phase, "recovered"); assert.equal(fixture.calls.filter(([operation]) => operation === "review").length, 1);
});

test("disposed workflow never displays an earlier recovery or offers an action", async () => {
  const { fixture, workflow } = await uncertainReview(); fixture.state.observed = false; await workflow.recover();
  assert.match(htmlFor(workflow), /Outcome: not observed/);
  workflow.dispose(); assert.equal(workflow.snapshot().uncertainWrite, "review", "retirement does not prove a write outcome");
  assert.doesNotMatch(htmlFor(workflow), /Outcome:|Separately observed review state:/);
  assert.ok(elements(treeFor(workflow)).filter(item => item.type === "button").every(item => item.props.disabled));
  const before = fixture.calls.length; await workflow.recover(); assert.equal(fixture.calls.length, before);
});

test("confirmed and provably not-dispatched review writes do not expose uncertain-event recovery", async () => {
  for (const outcome of ["confirmed", "not_dispatched"]) {
    const { fixture, workflow } = await uncertainReview(); await workflow.recover(); await workflow.detail();
    fixture.state.unknownReview = false;
    if (outcome === "not_dispatched") fixture.backend.reviewReport = async () => ({ ...fixture.envelope(null), outcome });
    await workflow.review("closed", () => workflowId(7));
    assert.equal(workflow.snapshot().uncertainWrite, null);
    assert.equal(workflow.snapshot().reason, outcome === "confirmed" ? null : "not_dispatched");
    assert.equal(button(workflow, "Look up the uncertain review event").props.disabled, true);
    assert.equal(button(workflow, "Read a fresh queue snapshot").props.disabled, false);
  }
});
