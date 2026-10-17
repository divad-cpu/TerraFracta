import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { sharedViewModule } from "./helpers/shared_view_module.mjs";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { elements } from "./helpers/correction_draft_harness.mjs";
import { recordedReferenceEntries } from "../src/recorded-reference-finder.ts";
import { recordedProposalSourceIndex } from "../src/recorded-proposal-source-index.ts";
import { proposedPayload, proposalId } from "./helpers/proposal_fixture.mjs";

const file = new URL("../src/recorded-reference-finder-view.tsx", import.meta.url);
function rows() {
  const proposed = proposedPayload().snapshot, base = structuredClone(proposed);
  base.claims[0].evidence[0].title = "Recorded Cafe\u0301 inventory";
  proposed.claims[0].evidence[0].title = "Proposed ﬁle inventory";
  proposed.claims[0].type = "delivery";
  return recordedReferenceEntries(recordedProposalSourceIndex(base, proposed));
}
const input = (h, suffix) => h.nodes().find(n => n.props.id?.endsWith(`-${suffix}`)) ?? assert.fail(suffix);
const change = (h, suffix, value) => input(h, suffix).props.onChange({ currentTarget: { value } });
const clear = h => h.nodes().find(n => n.type === "button").props;
const targets = h => h.nodes().filter(n => n.type === "a").map(n => n.props.href);
const create = () => sharedViewModule(file, "RecordedReferenceFinder");

test("finder starts quietly with labelled controls, a polite status and no implicit duplicate result list", () => {
  const h = create()({ entries: rows() }); h.commit();
  const html = h.html(), nodes = h.nodes(), ids = new Set(nodes.map(n => n.props.id).filter(Boolean));
  assert.match(html, /4 captured reference occurrences available/);
  assert.equal(targets(h).length, 0); assert.equal(clear(h).disabled, true);
  assert.equal(nodes.filter(n => n.type === "form").length, 0);
  assert.equal(nodes.filter(n => n.type === "select").length, 3);
  for (const label of nodes.filter(n => n.type === "label")) assert.ok(ids.has(label.props.htmlFor));
  for (const node of nodes) for (const ref of String(node.props["aria-describedby"] ?? "").split(" ").filter(Boolean)) assert.ok(ids.has(ref), ref);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /Filters may hide conflicting references/); h.unmount();
});

test("query and independent filters intersect at original links while clear restores only the locator", t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("finder must not request data"));
  const entries = rows(), before = structuredClone(entries), h = create()({ entries }); h.commit();
  change(h, "query", "contrasting");
  assert.deepEqual(targets(h), [`#proposal-base-reference-${proposalId(3)}-2`, `#proposal-proposed-reference-${proposalId(3)}-2`]);
  change(h, "side", "proposed"); change(h, "type", "delivery"); change(h, "relation", "contradicts");
  assert.deepEqual(targets(h), [`#proposal-proposed-reference-${proposalId(3)}-2`]);
  assert.match(h.html(), /Proposed<!-- --> statement <!-- -->1<!-- -->, reference <!-- -->2|Proposed statement 1, reference 2/);
  assert.match(h.html(), /1 of 4 captured reference occurrences match/);
  clear(h).onClick(); assert.deepEqual(targets(h), []);
  for (const field of ["query", "side", "type", "relation"]) assert.equal(input(h, field).props.value, "");
  assert.deepEqual(entries, before); h.unmount();
});

test("Unicode marks preserve original glyphs, invalid queries withhold results, and absent matches stay bounded", () => {
  const h = create()({ entries: rows() }); h.commit();
  change(h, "query", "file"); assert.match(h.html(), /<mark>ﬁle<\/mark>/);
  change(h, "query", "café"); assert.match(h.html(), /<mark>Café<\/mark>/);
  change(h, "query", "x".repeat(81)); assert.equal(input(h, "query").props["aria-invalid"], true); assert.deepEqual(targets(h), []);
  assert.match(h.html(), /selection is invalid/);
  change(h, "query", "missing material"); assert.match(h.html(), /No matching reference in these captured panels/);
  assert.match(h.html(), /not evidence that a source, action or conflict is absent elsewhere/); h.unmount();
});

test("HTML-shaped stored labels remain escaped even when a result is matched", () => {
  const entries = rows(); entries[0] = { ...entries[0], title: "<script>invented-canary</script>", locator: "<em>location</em>" };
  const h = create()({ entries }); h.commit(); change(h, "query", "invented-canary");
  const html = h.html(); assert.match(html, /&lt;script&gt;/); assert.match(html, /&lt;em&gt;/);
  assert.doesNotMatch(html, /<script>|<em>location/); assert.ok(targets(h).every(href => href.startsWith("#proposal-"))); h.unmount();
});

test("retained handlers of a replaced keyed finder cannot transfer search state to its successor", () => {
  const mount = create(), old = mount({ entries: rows() }); old.commit();
  change(old, "query", "file"); const editOld = input(old, "query").props.onChange, clearOld = clear(old).onClick;
  old.unmount(); const successor = mount({ entries: rows().map(row => ({ ...row, title: "Replacement captured label" })) }); successor.commit();
  editOld({ currentTarget: { value: "PRIVATE_OLD_QUERY" } }); clearOld();
  assert.equal(input(successor, "query").props.value, ""); assert.deepEqual(targets(successor), []);
  assert.doesNotMatch(successor.html(), /PRIVATE_OLD_QUERY/); successor.unmount();
});

test("ordinary batched input edits capture event values before deferred React state updaters", () => {
  const cells = [], queued = []; let cursor = 0;
  const hooks = { useId: () => "finder-batched", useRef(initial) {
    const i = cursor++; if (!(i in cells)) cells[i] = { current: initial }; return cells[i];
  }, useLayoutEffect() {}, useState(initial) {
    const i = cursor++; if (!(i in cells)) cells[i] = initial;
    return [cells[i], update => queued.push(() => { cells[i] = typeof update === "function" ? update(cells[i]) : update; })];
  } };
  const View = loadTsx(file, name => name === "react" ? hooks : undefined).RecordedReferenceFinder;
  const entries = rows(), render = () => { cursor = 0; return View({ entries }); };
  for (const [suffix, value] of [["query", "contrasting"], ["side", "proposed"], ["type", "delivery"], ["relation", "contradicts"]]) {
    const node = elements(render()).find(n => n.props.id?.endsWith(`-${suffix}`));
    const event = { currentTarget: { value } }; node.props.onChange(event); event.currentTarget = null;
  }
  for (const apply of queued.splice(0)) apply();
  const tree = render(), html = renderToStaticMarkup(tree);
  assert.match(html, /1 of 4 captured reference occurrences match/);
  assert.equal(elements(tree).filter(n => n.type === "a").length, 1);
});
