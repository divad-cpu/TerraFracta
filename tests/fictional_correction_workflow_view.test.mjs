import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createFictionalCorrectionWorkflow } from "../src/fictional-correction-workflow.ts";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { elements } from "./helpers/correction_draft_harness.mjs";
import { fictionalWorkflowFixture, workflowId } from "./helpers/fictional_correction_workflow_fixture.mjs";
const View = loadTsx(new URL("../src/fictional-correction-workflow-view.tsx", import.meta.url)).FictionalCorrectionWorkflowView;
const render = state => renderToStaticMarkup(createElement(View, { state }));
const tick = () => new Promise(resolve => setImmediate(resolve));

test("local setup refusal and adapter refusal render a truthful common notice without inventing an acknowledgement", async t => {
  for (const refusal of ["local", "adapter"]) {
    const fixture = fictionalWorkflowFixture(), faults = [];
    const workflow = createFictionalCorrectionWorkflow(fixture.backend, { onFault: code => faults.push(code) });
    await workflow.load(); workflow.prepare("statement", () => workflowId(4));
    const prepared = structuredClone(workflow.snapshot().request);
    if (refusal === "local") {
      const NativeController = globalThis.AbortController;
      t.mock.method(globalThis, "AbortController", class extends NativeController {
        constructor() {
          super();
          t.mock.method(this.signal, "addEventListener", () => { throw Error("INVENTED_PRIVATE_SETUP_CANARY"); });
        }
      });
    } else fixture.backend.submitRequest = async request => {
      fixture.calls.push(["submit", structuredClone(request)]);
      return { ...fixture.envelope(null), outcome: "not_dispatched" };
    };
    let result;
    try { result = await workflow.submit(); } finally { t.mock.restoreAll(); }
    assert.equal(result.phase, "held"); assert.equal(result.reason, "not_dispatched");
    assert.equal(result.busy, false); assert.equal(result.uncertainWrite, null);
    assert.deepEqual(result.request, prepared); assert.equal(result.intake, null);
    assert.equal(fixture.calls.filter(([operation]) => operation === "submit").length, refusal === "local" ? 0 : 1);
    assert.deepEqual(faults, refusal === "local" ? ["fictional_correction_submit"] : []);
    const html = render(result);
    assert.ok(html.includes("This command was not dispatched. No storage is claimed."));
    for (const forbidden of ["The adapter confirmed", "Confirmed private intake receipt", fixture.issue.title, "INVENTED_PRIVATE_SETUP_CANARY"])
      assert.ok(!html.includes(forbidden), `${refusal}: ${forbidden}`);
    workflow.dispose();
  }
});

function harness(initialBackend) {
  let backend = initialBackend, states = [], refs = [], effects = [], stateSlot = 0, refSlot = 0, effectSlot = 0;
  const react = { useState(initial) { const slot = stateSlot++; if (!(slot in states)) states[slot] = typeof initial === "function" ? initial() : initial;
      return [states[slot], value => { states[slot] = typeof value === "function" ? value(states[slot]) : value; }]; },
    useRef(initial) { const slot = refSlot++; return refs[slot] ??= { current: initial }; },
    useEffect(effect, dependencies) { const slot = effectSlot++, old = effects[slot];
      if (!old || dependencies.some((value, i) => value !== old.dependencies[i])) effects[slot] = { effect, dependencies, prior: old?.cleanup, pending: true }; }, };
  const Exercise = loadTsx(new URL("../app/editorial-preview/corrections/FictionalCorrectionExercise.tsx", import.meta.url), name => name === "react" ? react : undefined).FictionalCorrectionExercise;
  function render(next = backend) { backend = next; stateSlot = refSlot = effectSlot = 0; const tree = Exercise({ backend }); return tree.type(tree.props); }
  return { render, effects() { for (const item of effects) if (item.pending) { item.prior?.(); item.cleanup = item.effect(); item.pending = false; } },
    recreateEffects() { for (const item of effects) { item.cleanup?.(); item.cleanup = item.effect(); } },
    stop() { for (const item of effects) item.cleanup?.(); }, state: () => states[0].state };
}
function button(tree, label) { const value = elements(tree).find(item => item.type === "button" && item.props.children === label); assert.ok(value, label); return value; }

test("default actual workflow presenter has honest unavailable status, disabled controls and no form or saved success", () => {
  const html = render(createFictionalCorrectionWorkflow().snapshot());
  assert.ok(html.includes("No report was sent or saved") && html.includes("disabled"));
  for (const forbidden of ["<textarea", '<input', '<form', "Confirmed private intake receipt", 'href="https:']) assert.ok(!html.includes(forbidden), forbidden);
});
test("actual client callbacks drive the same injected workflow through one report; disabled/default is kept separate", async () => {
  const fixture = fictionalWorkflowFixture(), h = harness(fixture.backend);
  h.render(); h.effects(); let tree = h.render();
  button(tree, "Read the current fictional target").props.onClick(); await tick(); tree = h.render();
  const old = Object.getOwnPropertyDescriptor(globalThis, "crypto"); let id = 4;
  try { Object.defineProperty(globalThis, "crypto", { configurable: true, value: { randomUUID: () => workflowId(id++) } });
    button(tree, "Prepare the fixed statement report").props.onClick(); tree = h.render();
    assert.equal(h.state().request.draft.target.claimId, fixture.issue.claims[0].id);
    button(tree, "Send the fixed fictional request").props.onClick(); await tick(); tree = h.render();
    button(tree, "Read a fresh queue snapshot").props.onClick(); await tick(); tree = h.render();
    button(tree, "Read this report's detail").props.onClick(); await tick(); tree = h.render();
    button(tree, "Start the private review").props.onClick(); await tick(); tree = h.render();
    assert.equal(button(tree, "Close the technical exercise").props.disabled, true);
    button(tree, "Read this report's detail").props.onClick(); await tick(); tree = h.render();
    button(tree, "Close the technical exercise").props.onClick(); await tick(); tree = h.render();
    button(tree, "Read this report's detail").props.onClick(); await tick();
    assert.equal(h.state().detail.report.reviewState, "closed");
    assert.equal(fixture.calls.filter(([operation]) => operation === "submit").length, 1);
    assert.equal(fixture.calls.filter(([operation]) => operation === "review").length, 2);
  } finally { Object.defineProperty(globalThis, "crypto", old); h.stop(); }
});
test("backend replacement hides prior content before effects; cleanup consumes old late read without restoring it", async () => {
  const first = fictionalWorkflowFixture(), next = fictionalWorkflowFixture(); next.backend.executionId = workflowId(88);
  let resolve; first.backend.readCurrent = () => new Promise(r => { resolve = r; });
  const h = harness(first.backend); h.render(); h.effects(); let tree = h.render();
  button(tree, "Read the current fictional target").props.onClick(); await tick();
  const beforeEffect = h.render(next.backend);
  const text = renderToStaticMarkup(beforeEffect); assert.ok(!text.includes(first.issue.title));
  assert.ok(text.includes("No report was sent or saved"));
  h.effects(); resolve(first.envelope(first.issue)); await tick();
  assert.equal(h.state().issue, null); assert.equal(h.state().executionId, workflowId(88)); h.stop();
});
test("held workflow withholds old draft/queue/detail while retaining identity and accurate unknown-write recovery message", async () => {
  const fixture = fictionalWorkflowFixture(), workflow = createFictionalCorrectionWorkflow(fixture.backend, { onFault: () => {} });
  await workflow.load(); workflow.prepare("statement", () => workflowId(4)); fixture.state.unknownIntake = true; await workflow.submit();
  const html = render(workflow.snapshot());
  assert.ok(html.includes(workflowId(4)) && html.includes("no read-only intake recovery operation"));
  assert.ok(!html.includes(fixture.issue.title) && !html.includes("Invented explanation for a private technical correction test."));
  assert.ok(!html.includes("Confirmed private intake receipt"));
});
test("actual correction workflow page denies production before selectors and invalid query cannot dispatch or echo", async () => {
  const file = new URL("../app/editorial-preview/corrections/page.tsx", import.meta.url), marker = new Error("not-found");
  const intercept = name => name === "next/navigation" ? { notFound() { throw marker; } } : undefined;
  const production = loadTsx(file, intercept, { env: { NODE_ENV: "production" } }).default;
  let getters = 0; await assert.rejects(production(Object.defineProperty({}, "searchParams", { get() { getters++; throw new Error("private"); } })), error => error === marker);
  assert.equal(getters, 0);
  const page = loadTsx(file, intercept).default;
  const invalid = renderToStaticMarkup(await page({ searchParams: Promise.resolve({ backend: "private-canary" }) }));
  assert.ok(invalid.includes("Nothing was dispatched")); assert.ok(!invalid.includes("private-canary"));
  const valid = renderToStaticMarkup(await page({ searchParams: Promise.resolve({}) }));
  assert.equal((valid.match(/<h1>/g) ?? []).length, 1); assert.ok(valid.includes("No report was sent or saved"));
});


test("held confirmed intake never enables a target reload; disposed controls stay disabled", async () => {
  const fixture = fictionalWorkflowFixture(), workflow = createFictionalCorrectionWorkflow(fixture.backend, { onFault: () => {} });
  await workflow.load(); workflow.prepare("statement", () => workflowId(4)); await workflow.submit();
  fixture.backend.readQueue = async () => { throw new Error("invented unavailable queue"); }; await workflow.queue();
  const actions = Object.fromEntries(["load", "preparePage", "prepareStatement", "submit", "queue", "nextPage", "detail", "startReview", "closeReview", "recover", "cancel"].map(key => [key, () => {}]));
  let tree = View({ state: workflow.snapshot(), actions });
  assert.equal(button(tree, "Read the current fictional target").props.disabled, true);
  assert.equal(button(tree, "Read a fresh queue snapshot").props.disabled, false);
  workflow.dispose(); tree = View({ state: workflow.snapshot(), actions });
  assert.ok(elements(tree).filter(item => item.type === "button").every(item => item.props.disabled));
});

test("actual client recovery callback survives a failed lookup and repeats only the original event read", async () => {
  const fixture = fictionalWorkflowFixture(), h = harness(fixture.backend), original = fixture.backend.lookupReviewEvent;
  fixture.state.unknownReview = true;
  const old = Object.getOwnPropertyDescriptor(globalThis, "crypto"); let id = 4;
  try {
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: { randomUUID: () => workflowId(id++) } });
    h.render(); h.effects();
    for (const label of ["Read the current fictional target", "Prepare the fixed statement report", "Send the fixed fictional request",
      "Read a fresh queue snapshot", "Read this report's detail", "Start the private review"]) {
      const item = button(h.render(), label); assert.equal(item.props.disabled, false, label); item.props.onClick(); await tick();
    }
    const request = structuredClone(h.state().reviewRequest);
    fixture.backend.lookupReviewEvent = async input => { fixture.calls.push(["recover", structuredClone(input)]); throw Error("invented unavailable lookup"); };
    button(h.render(), "Look up the uncertain review event").props.onClick(); await tick();
    let tree = h.render(); assert.equal(h.state().reason, "unavailable");
    assert.equal(button(tree, "Look up the uncertain review event").props.disabled, false);
    assert.equal(button(tree, "Read a fresh queue snapshot").props.disabled, true);
    fixture.backend.lookupReviewEvent = original;
    button(tree, "Look up the uncertain review event").props.onClick(); await tick(); tree = h.render();
    assert.equal(h.state().phase, "recovered"); assert.equal(h.state().uncertainWrite, null);
    assert.equal(button(tree, "Look up the uncertain review event").props.disabled, true);
    assert.equal(fixture.calls.filter(([operation]) => operation === "review").length, 1);
    assert.deepEqual(fixture.calls.filter(([operation]) => operation === "recover").map(([, input]) => input), [request, request]);
  } finally { Object.defineProperty(globalThis, "crypto", old); h.stop(); }
});

for (const recreation of ["backend A to B to A", "same-backend effect recreation"]) {
  test(`retired submit controls cannot write a successor request after ${recreation}`, async () => {
    const first = fictionalWorkflowFixture(), other = fictionalWorkflowFixture(), h = harness(first.backend);
    other.backend.executionId = workflowId(88);
    const old = Object.getOwnPropertyDescriptor(globalThis, "crypto"); let ids = 40;
    async function prepare() {
      button(h.render(), "Read the current fictional target").props.onClick(); await tick();
      button(h.render(), "Prepare the fixed statement report").props.onClick();
    }
    try {
      Object.defineProperty(globalThis, "crypto", { configurable: true, value: { randomUUID: () => workflowId(ids++) } });
      h.render(); h.effects(); await prepare();
      const previousRequest = structuredClone(h.state().request), retired = button(h.render(), "Send the fixed fictional request").props;
      assert.equal(retired.disabled, false);
      if (recreation === "backend A to B to A") {
        h.render(other.backend); h.effects(); h.render(first.backend); h.effects();
      } else h.recreateEffects();
      await prepare(); const successor = structuredClone(h.state().request), calls = first.calls.length;
      assert.notEqual(successor.requestId, previousRequest.requestId);
      retired.onClick(); await tick();
      assert.equal(first.calls.length, calls); assert.equal(h.state().phase, "prepared");
      assert.deepEqual(h.state().request, successor);
      const fresh = button(h.render(), "Send the fixed fictional request").props; assert.equal(fresh.disabled, false);
      fresh.onClick(); await tick(); assert.equal(h.state().phase, "recorded");
      assert.deepEqual(first.calls.filter(([operation]) => operation === "submit"), [["submit", successor]]);
    } finally { Object.defineProperty(globalThis, "crypto", old); h.stop(); }
  });
}

test("retired cancellation cannot abort a successor read after the same backend is reused", async () => {
  const first = fictionalWorkflowFixture(), other = fictionalWorkflowFixture(), h = harness(first.backend), pending = [];
  other.backend.executionId = workflowId(88);
  first.backend.readCurrent = signal => new Promise(resolve => { pending.push({ signal, resolve }); });
  try {
    h.render(); h.effects(); button(h.render(), "Read the current fictional target").props.onClick(); await tick();
    const retired = button(h.render(), "Cancel waiting").props;
    h.render(other.backend); h.effects(); h.render(first.backend); h.effects();
    assert.equal(pending[0].signal.aborted, true);
    button(h.render(), "Read the current fictional target").props.onClick(); await tick();
    retired.onClick(); assert.equal(pending[1].signal.aborted, false);
    assert.equal(h.state().busy, true);
    pending[0].resolve(first.envelope(first.issue)); await tick(); assert.equal(h.state().issue, null);
    pending[1].resolve(first.envelope(first.issue)); await tick();
    assert.equal(h.state().phase, "ready"); assert.equal(h.state().busy, false);
  } finally { for (const item of pending) item.resolve(first.envelope(first.issue)); await tick(); h.stop(); }
});

test("retired preparation controls cannot replace a successor target or consume its identity", async () => {
  const fixture = fictionalWorkflowFixture(), h = harness(fixture.backend);
  const old = Object.getOwnPropertyDescriptor(globalThis, "crypto"); let ids = 40;
  try {
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: { randomUUID: () => workflowId(ids++) } });
    h.render(); h.effects(); button(h.render(), "Read the current fictional target").props.onClick(); await tick();
    const retired = button(h.render(), "Prepare the fixed page report").props; assert.equal(retired.disabled, false);
    h.recreateEffects(); button(h.render(), "Read the current fictional target").props.onClick(); await tick();
    button(h.render(), "Prepare the fixed statement report").props.onClick();
    const successor = structuredClone(h.state().request), consumed = ids;
    retired.onClick(); assert.equal(ids, consumed); assert.deepEqual(h.state().request, successor);
    button(h.render(), "Prepare the fixed page report").props.onClick();
    assert.equal(h.state().request.draft.target.claimId, null); assert.equal(ids, consumed + 1);
  } finally { Object.defineProperty(globalThis, "crypto", old); h.stop(); }
});

test("retired review control cannot select a successor report or consume a review identity", async () => {
  const fixture = fictionalWorkflowFixture(), h = harness(fixture.backend);
  const old = Object.getOwnPropertyDescriptor(globalThis, "crypto"); let ids = 40;
  async function detail() {
    for (const label of ["Read the current fictional target", "Prepare the fixed statement report", "Send the fixed fictional request", "Read a fresh queue snapshot", "Read this report's detail"]) {
      const item = button(h.render(), label).props; assert.equal(item.disabled, false, label); item.onClick(); await tick();
    }
  }
  try {
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: { randomUUID: () => workflowId(ids++) } });
    h.render(); h.effects(); await detail();
    const retired = button(h.render(), "Start the private review").props; assert.equal(retired.disabled, false);
    h.recreateEffects(); await detail();
    const successor = structuredClone(h.state().detail), consumed = ids, calls = fixture.calls.length;
    retired.onClick(); await tick(); assert.equal(ids, consumed); assert.equal(fixture.calls.length, calls);
    assert.deepEqual(h.state().detail, successor); assert.equal(h.state().reviewRequest, null);
    button(h.render(), "Start the private review").props.onClick(); await tick();
    assert.equal(h.state().phase, "reviewed"); assert.equal(ids, consumed + 1);
    assert.equal(fixture.calls.filter(([operation]) => operation === "review").length, 1);
  } finally { Object.defineProperty(globalThis, "crypto", old); h.stop(); }
});
