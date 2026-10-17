import assert from "node:assert/strict";
import test from "node:test";
import { sharedViewModule } from "./helpers/shared_view_module.mjs";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { scopeDraftHarness } from "./helpers/scope_draft_harness.mjs";
import { responsibilityDraftHarness } from "./helpers/responsibility_draft_harness.mjs";
import { capturedScopeDraftContext } from "../src/server/issue-scope-draft.ts";
import { proposalReport } from "./helpers/proposal_fixture.mjs";

const field = (h, suffix) => h.nodes().find(node => node.props.id?.endsWith(suffix)) ?? assert.fail(suffix);
const button = (h, label) => h.nodes().find(node => node.type === "button" && node.props.children === label).props.onClick;
const edit = (h, suffix, value) => field(h, suffix).props.onChange({ currentTarget: { value } });
const forbidden = new Proxy({}, { get() { assert.fail("Retired filter inspected an event"); } });
// The scope seam exposes the same actual JSX through render rather than nodes.
import { elements } from "./helpers/correction_draft_harness.mjs";
function worksheet(factory) {
  const h = factory(capturedScopeDraftContext(proposalReport()));
  h.nodes ??= () => elements(h.render()); h.mount(); return h;
}
const finder = () => {
  const h = sharedViewModule(new URL("../src/recorded-reference-finder-view.tsx", import.meta.url), "RecordedReferenceFinder")({ entries: [] });
  h.commit(); return h;
};

test("scope search value getters cannot resurrect text after a reentrant show-all", () => {
  const h = worksheet(scopeDraftHarness); try {
    edit(h, "-reference-search", "supports"); const old = field(h, "-reference-search").props.onChange;
    const clear = button(h, "Show all reference choices");
    old({ currentTarget: { get value() { clear(); return "older"; } } });
    assert.equal(field(h, "-reference-search").props.value, "");
  } finally { h.unmount(); }
});
for (const [label, factory] of [["scope", scopeDraftHarness], ["responsibility", responsibilityDraftHarness]]) {
  test(`${label} search value getters cannot overwrite a nested newer query`, () => {
    const h = worksheet(factory); try {
      const old = field(h, "-reference-search").props.onChange;
      old({ currentTarget: { get value() { edit(h, "-reference-search", "newer"); return "older"; } } });
      assert.equal(field(h, "-reference-search").props.value, "newer");
    } finally { h.unmount(); }
  });
}
test("each finder input refuses its value when a reentrant clear retires that input epoch", () => {
  const h = finder(); try {
    for (const suffix of ["-query", "-side", "-type", "-relation"]) {
      edit(h, "-query", "active"); const old = field(h, suffix).props.onChange, clear = button(h, "Clear reference finder");
      old({ currentTarget: { get value() { clear(); return "older"; } } });
      for (const target of ["-query", "-side", "-type", "-relation"]) assert.equal(field(h, target).props.value, "", suffix);
    }
  } finally { h.unmount(); }
});
test("a stale finder clear cannot erase a later filter edit", () => {
  const h = finder(); try {
    edit(h, "-query", "first"); const old = button(h, "Clear reference finder");
    edit(h, "-side", "proposed"); old(); assert.equal(field(h, "-query").props.value, "first");
    assert.equal(field(h, "-side").props.value, "proposed");
  } finally { h.unmount(); }
});
test("nested newer finder edits win within one field while independent fields merge", () => {
  const h = finder(); try {
    const old = field(h, "-query").props.onChange;
    old({ currentTarget: { get value() { edit(h, "-query", "newer"); return "older"; } } });
    assert.equal(field(h, "-query").props.value, "newer");
    field(h, "-query").props.onChange({ currentTarget: { get value() { edit(h, "-side", "base"); return "independent"; } } });
    assert.equal(field(h, "-query").props.value, "independent"); assert.equal(field(h, "-side").props.value, "base");
  } finally { h.unmount(); }
});
test("finder clear and committed unmount retire callbacks before event access", () => {
  const h = finder(); try {
    edit(h, "-query", "first"); const old = field(h, "-query").props.onChange;
    button(h, "Clear reference finder")(); old(forbidden);
    const current = field(h, "-side").props.onChange; h.unmount(); current(forbidden);
    assert.equal(field(h, "-query").props.value, "");
  } finally { h.unmount(); }
});

test("finder layout reconnection schedules fresh usable controls without losing filter state or reviving old callbacks", () => {
  const cells = []; let cursor = 0, setup, writes = 0;
  const hooks = {
    useId: () => "finder-reconnect",
    useRef(initial) { const i = cursor++; if (!(i in cells)) cells[i] = { current: initial }; return cells[i]; },
    useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = initial;
      return [cells[i], value => { writes++; cells[i] = typeof value === "function" ? value(cells[i]) : value; }]; },
    useLayoutEffect(callback) { setup = callback; },
  };
  const View = loadTsx(new URL("../src/recorded-reference-finder-view.tsx", import.meta.url), name => name === "react" ? hooks : undefined).RecordedReferenceFinder;
  const h = { nodes() { cursor = 0; return elements(View({ entries: [] })); } };
  h.nodes(); let cleanup = setup();
  const values = [["-query", "supports"], ["-side", "proposed"], ["-type", "delivery"], ["-relation", "supports"]];
  for (const [suffix, value] of values) edit(h, suffix, value);
  const oldInputs = values.map(([suffix]) => field(h, suffix).props.onChange), oldClear = button(h, "Clear reference finder");
  const before = writes; cleanup(); cleanup = setup();
  assert.equal(writes, before + 1, "Reconnection must schedule the fresh callback render");
  for (const old of oldInputs) old(forbidden); oldClear();
  for (const [suffix, value] of values) assert.equal(field(h, suffix).props.value, value);
  edit(h, "-query", "new current query"); assert.equal(field(h, "-query").props.value, "new current query");
  const active = writes; setup(); assert.equal(writes, active, "Repeated live setup does not schedule a render");
  cleanup();
});
