import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { sharedViewModule } from "./helpers/shared_view_module.mjs";
import { capturedScopeDraftContext } from "../src/server/issue-scope-draft.ts";
import { proposalReport } from "./helpers/proposal_fixture.mjs";

const turn = () => new Promise(setImmediate);
const initialReport = JSON.parse(readFileSync(new URL("../fixtures/fictional_update_report.json", import.meta.url)));
const context = capturedScopeDraftContext(proposalReport());
assert.ok(context);
const variants = [
  { name: "captured scope file", file: "../src/issue-scope-draft-view.tsx", component: "IssueScopeDraftView", props: { context }, fileRead: true },
  { name: "weekly status", file: "../src/weekly-rehearsal-status-view.tsx", component: "WeeklyRehearsalStatusView", queued: true },
  { name: "saved history", file: "../app/update-preview/history.tsx", component: "FictionalHistory", props: { onInspect() { assert.fail("no saved result qualified"); } } },
  { name: "fictional update", file: "../app/update-preview/operation.tsx", component: "UpdateOperation", props: { initialReport }, post: true },
];
const fileInput = h => h.nodes().find(node => node.type === "input" && node.props.type === "file").props;
function invoke(h, v, file) {
  if (v.fileRead) fileInput(h).onChange({ currentTarget: { files: [file], value: "INVENTED_FILE" } });
  else if (v.post) h.nodes().find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  else h.nodes().find(node => node.type === "button").props.onClick();
}

for (const v of variants) for (const originalThrows of [false, true])
  test(`${v.name}: dispatch-time replacement preserves the admitted physical owner, throws ${originalThrows}`, async t => {
    Response.json({ error: "fictional_archive_full" });
    const pending = [], instances = [], codes = [], bytes = new TextEncoder().encode("{}");
    let calls = 0, countBeforeOriginalReturned, old, next;
    const empty = () => null;
    const create = sharedViewModule(new URL(v.file, import.meta.url), v.component, name => {
      if (name.endsWith("client-error-diagnostics.ts")) return { observeClientError: code => codes.push(code) };
      if (v.post && name === "./history") return { FictionalHistory: empty };
      if (v.post && name === "./comparison") return { FictionalComparison: empty };
      if (v.post && name === "./candidate") return { FictionalCandidate: empty };
      return undefined;
    });
    function port() {
      calls++; let resolve; const promise = new Promise(done => { resolve = done; }); pending.push(resolve);
      if (calls === 1) {
        old.unmount(); next = create(v.props); instances.push(next); next.commit(); invoke(next, v, file);
        countBeforeOriginalReturned = calls;
        if (originalThrows) throw Error("PRIVATE_ORIGINAL_DISPATCH_FAULT");
      }
      return promise;
    }
    const file = { size: bytes.length, slice() { return { arrayBuffer: port }; } };
    t.mock.method(globalThis, "fetch", (url, options) => {
      assert.equal(v.fileRead, undefined, "local file inspection cannot use transport");
      assert.ok(url.startsWith("/api/dev/")); assert.equal(options.method, v.post ? "POST" : "GET");
      assert.equal(options.cache, "no-store");
      if (v.post) assert.deepEqual(JSON.parse(options.body), { trigger: "manual", scenario: "standard" });
      else assert.equal(options.body, undefined);
      return port();
    });
    const complete = () => v.fileRead ? bytes.buffer : Response.json({ error: "fictional_archive_full" }, { status: 503 });
    old = create(v.props); instances.push(old); old.commit();
    try {
      invoke(old, v, file);
      assert.equal(countBeforeOriginalReturned, 1, "replacement cannot dispatch before the original owner is registered");
      await turn();
      if (!originalThrows) { assert.equal(calls, 1); pending[0](complete()); await turn(); }
      if (v.queued) assert.equal(calls, 2, "one explicitly requested weekly observer proceeds after drain");
      else { assert.equal(calls, 1, "settlement cannot implicitly repeat an operation or reopen a file"); invoke(next, v, file); }
      await turn(); assert.equal(calls, 2);
      pending.at(-1)(complete()); await turn(); assert.equal(calls, 2);
      assert.doesNotMatch(next.html(), /PRIVATE_|Rehearsal finished:|Local preparation file opened|8 saved receipts/);
      assert.ok(codes.every(code => typeof code === "string" && !code.includes("PRIVATE")));
    } finally { instances.forEach(item => item.unmount()); pending.forEach(resolve => resolve(complete())); await turn(); }
  });
