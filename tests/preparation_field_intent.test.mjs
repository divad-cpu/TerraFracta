import assert from "node:assert/strict";
import test from "node:test";
import { scopeDraftHarness } from "./helpers/scope_draft_harness.mjs";
import { responsibilityDraftHarness } from "./helpers/responsibility_draft_harness.mjs";
import { capturedScopeDraftContext } from "../src/server/issue-scope-draft.ts";
import { proposalReport } from "./helpers/proposal_fixture.mjs";
import { preparationInputIntent } from "../src/preparation-input-intent.ts";

const field = (h, suffix) => h.nodes().find(node => node.props.id?.endsWith(suffix)) ?? assert.fail(suffix);
const click = (h, text) => h.nodes().find(node => node.props.children === text).props.onClick();
const edit = (h, suffix, value) => field(h, suffix).props.onChange({ currentTarget: { value } });
const choose = (h, suffix, values) => field(h, suffix).props.onChange({ currentTarget: { selectedOptions: values.map(value => ({ value })) } });
const forbidden = new Proxy({}, { get() { assert.fail("Retired input inspected an event"); } });
const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(setImmediate); };
const modes = [
  { label: "scope", factory: scopeDraftHarness, wording: "-population-wording", references: "-population-references", other: "-period-wording", clear: "Clear scope draft" },
  { label: "responsibility", factory: responsibilityDraftHarness, wording: "-1-institution-wording", references: "-1-institution-references", other: "-1-role-wording", clear: "Clear responsibility draft" },
];
function ready(mode) {
  const context = capturedScopeDraftContext(proposalReport()), h = mode.factory(context); h.mount();
  if (mode.label === "responsibility") click(h, "Add responsibility entry");
  return { h, context };
}
for (const mode of modes) {
  test(`${mode.label} nested newer wording cannot be overwritten by an older value getter`, () => {
    const { h } = ready(mode); try {
      field(h, mode.wording).props.onChange({ currentTarget: { get value() { edit(h, mode.wording, "newer"); return "older"; } } });
      assert.equal(field(h, mode.wording).props.value, "newer");
    } finally { h.unmount(); }
  });
  test(`${mode.label} selected-option extraction preserves a nested newer reference choice`, () => {
    const { h, context } = ready(mode); try {
      const id = context.claims[0].id;
      field(h, mode.references).props.onChange({ currentTarget: { get selectedOptions() {
        choose(h, mode.references, [`${id}:2`]); return [{ value: `${id}:1` }];
      } } });
      assert.deepEqual(field(h, mode.references).props.value, [`${id}:2`]);
    } finally { h.unmount(); }
  });
  test(`${mode.label} nested newer pasted JSON remains exact and does not become a reviewed preparation`, () => {
    const { h } = ready(mode); try {
      field(h, "-reopen-json").props.onChange({ currentTarget: { get value() { edit(h, "-reopen-json", "NEWER_PRIVATE_JSON"); return "OLDER_PRIVATE_JSON"; } } });
      assert.equal(field(h, "-reopen-json").props.value, "NEWER_PRIVATE_JSON");
      assert.equal(h.nodes().some(node => node.props.readOnly), false);
    } finally { h.unmount(); }
  });
  test(`${mode.label} cancellation reentry cannot apply older wording over a newer edit or free physical File work`, async t => {
    const { h } = ready(mode); let finish, active = false;
    const nativeAbort = AbortController.prototype.abort;
    t.mock.method(AbortController.prototype, "abort", function (...args) {
      if (active) { active = false; edit(h, mode.wording, "newer during cancellation"); }
      return nativeAbort.apply(this, args);
    });
    try {
      field(h, "-file").props.onChange({ currentTarget: { files: [{ size: 2, slice() { return { arrayBuffer: () => new Promise(resolve => { finish = resolve; }) }; } }], value: "PRIVATE_NAME" } });
      await tick(); assert.equal(typeof finish, "function", "Observe physical producer entry before cancellation");
      active = true; edit(h, mode.wording, "older before cancellation");
      assert.equal(field(h, mode.wording).props.value, "newer during cancellation");
      assert.equal(field(h, "-file").props.disabled, true);
      finish(new Uint8Array([0, 0]).buffer); await tick();
      assert.equal(field(h, mode.wording).props.value, "newer during cancellation");
    } finally { active = false; finish?.(new Uint8Array([0, 0]).buffer); h.unmount(); await tick(); }
  });
}
test("a nested newer associated-statement deselection is not restored by its older getter", () => {
  const { h, context } = ready(modes[1]); try {
    field(h, "-1-statement").props.onChange({ currentTarget: { get value() { edit(h, "-1-statement", ""); return context.claims[0].id; } } });
    assert.equal(field(h, "-1-statement").props.value, "");
  } finally { h.unmount(); }
});
test("different controls still merge during nested and deferred changes while same-control newer values win", () => {
  for (const mode of modes) {
    const { h, context } = ready(mode); try {
      h.pauseMerges();
      field(h, mode.wording).props.onChange({ currentTarget: { get value() {
        edit(h, mode.other, "independent other wording"); choose(h, mode.references, [`${context.claims[0].id}:1`]); return "outer wording";
      } } });
      h.flushMerges(); assert.equal(field(h, mode.wording).props.value, "outer wording");
      assert.equal(field(h, mode.other).props.value, "independent other wording"); assert.deepEqual(field(h, mode.references).props.value, [`${context.claims[0].id}:1`]);
      h.pauseMerges(); const same = field(h, mode.wording).props.onChange;
      same({ currentTarget: { value: "queued older" } }); same({ currentTarget: { value: "queued newer" } }); h.flushMerges();
      assert.equal(field(h, mode.wording).props.value, "queued newer");
    } finally { h.unmount(); }
  }
});
test("a scope paste getter reentering Clear cannot restore text and retired callbacks refuse before event access", () => {
  const { h } = ready(modes[0]); try {
    const old = field(h, "-reopen-json").props.onChange;
    old({ currentTarget: { get value() { click(h, "Clear scope draft"); return "OLDER_PRIVATE_JSON"; } } });
    assert.equal(field(h, "-reopen-json").props.value, ""); old(forbidden);
    const latest = field(h, "-population-wording").props.onChange; h.unmount(); latest(forbidden);
  } finally { h.unmount(); }
});
test("control tokens are bounded to the live epoch and retirement never allocates or touches an event", () => {
  const ref = { current: { epoch: -1, controls: new Map() } }; let prior;
  for (let epoch = 0; epoch < 100; epoch++) {
    for (let row = 0; row < 8; row++) assert.ok(preparationInputIntent(ref, epoch, `${epoch}:${row}`, () => true)());
    assert.equal(ref.current.controls.size, 8); if (prior) assert.equal(prior(), false);
    prior = preparationInputIntent(ref, epoch, `${epoch}:0`, () => true);
  }
  const old = ref.current; assert.equal(preparationInputIntent(ref, 101, "retired", () => false), null); assert.equal(ref.current, old);
});
