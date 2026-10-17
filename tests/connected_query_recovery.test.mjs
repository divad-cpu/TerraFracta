import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { connectedInput, suppressionInput } from "./helpers/connected_reader_fixture.mjs";
import { parseConnectedReaderSnapshot } from "../src/connected-fictional-reader.ts";

const navigation = createRequire(import.meta.url)("next/navigation");
const REFUSED = Symbol("expected connected route refusal");
const views = ["overview", "issue", "sources", "search"];
function harness(mode, result = { kind: "empty" }) {
  const environment = arguments.length === 0 ? "development" : mode;
  const calls = []; let factories = 0;
  const Page = loadTsx(new URL("../app/connected-preview/[view]/page.tsx", import.meta.url), name => {
    if (name === "next/navigation") return { ...navigation, notFound() { throw REFUSED; } };
    if (name.endsWith("/server/connected-fictional-store")) return { connectedFictionalStore() { factories++; return { async current(edition) { calls.push(edition); if (result instanceof Error) throw result; return result; } }; } };
    return undefined;
  }, { env: { NODE_ENV: environment } }).default;
  return { Page, calls, get factories() { return factories; }, render: async props => renderToStaticMarkup(await Page(props)) };
}
const input = (view = "overview", query = {}) => ({ params: Promise.resolve({ view }), searchParams: Promise.resolve(query) });
async function refused(h, props) {
  await assert.rejects(h.Page(props), error => error === REFUSED);
  assert.deepEqual(h.calls, []); assert.equal(h.factories, 0);
}

test("rejected connected route params refuse before query observation or store construction", async () => {
  for (const fault of [Error("PRIVATE_CANARY"), "PRIVATE_CANARY", null]) {
    const h = harness(); let queryReads = 0;
    await refused(h, { params: Promise.reject(fault), get searchParams() { queryReads++; return Promise.resolve({ edition: "2" }); } });
    assert.equal(queryReads, 0);
  }
});

test("rejected connected search port reaches not-found without inspecting a fictional edition", async () => {
  for (const view of views) {
    const h = harness(); await refused(h, { params: Promise.resolve({ view }), searchParams: Promise.reject(Error("PRIVATE_CANARY")) });
  }
});

test("throwing and rejected connected route or query thenables are observed once before refusal", async () => {
  for (const field of ["params", "searchParams"]) for (const form of ["getter", "reject"]) {
    const h = harness(); let observed = 0;
    const port = form === "getter" ? { get then() { observed++; throw Error("PRIVATE_CANARY"); } }
      : { then(resolve, reject) { observed++; reject(Error("PRIVATE_CANARY")); } };
    const props = input("search", { edition: "2", q: "fictional" }); props[field] = port;
    await refused(h, props); assert.equal(observed, 1);
  }
});

test("malformed resolved connected params or queries refuse before any store observation", async () => {
  for (const [field, value] of [["params", null], ["params", undefined], ["params", []], ["searchParams", null], ["searchParams", undefined], ["searchParams", []], ["searchParams", { path: "PRIVATE_CANARY" }], ["searchParams", { edition: ["1", "2"] }]]) {
    const h = harness(), props = input(); props[field] = Promise.resolve(value); await refused(h, props);
  }
});

test("successful connected route and query values are admitted once without a second then assimilation", async () => {
  const h = harness(), counts = { params: 0, searchParams: 0 }, props = {};
  for (const [field, value] of Object.entries({ params: { view: "search" }, searchParams: { edition: "2", q: "fictional" } })) {
    Object.defineProperty(value, "then", { get() { counts[field]++; if (counts[field] === 1) return undefined; throw Error("PRIVATE_CANARY"); } }); props[field] = value;
  }
  const html = await h.render(props);
  assert.deepEqual(counts, { params: 1, searchParams: 1 }); assert.deepEqual(h.calls, [2]); assert.equal(h.factories, 1);
  assert.match(html, /No connected update yet/); assert.doesNotMatch(html, /PRIVATE_CANARY/);
});

test("supported connected views retain exact edition and unchanged fictional empty current and withheld presentation", async () => {
  const active = { kind: "snapshot", snapshot: parseConnectedReaderSnapshot({ ...connectedInput(), generation: 2 }) };
  const suppressed = { kind: "snapshot", snapshot: parseConnectedReaderSnapshot({ ...suppressionInput(), generation: 2 }) };
  for (const view of views) for (const result of [{ kind: "empty" }, { kind: "unavailable" }, { kind: "changed", currentGeneration: 3 }, active, suppressed]) {
    const h = harness("development", result), html = await h.render(input(view, { edition: "2", ...(view === "search" ? { q: "fictional" } : {}) }));
    assert.deepEqual(h.calls, [2]); assert.equal(h.factories, 1); assert.match(html, /No real country, survey or policy is described/);
    if (result === active) { assert.match(html, /27\.4%/); assert.match(html, /data-connected-edition="2"/); }
    else assert.doesNotMatch(html, /27\.4%|example\.org\/fictional-table/);
    if (result === suppressed) assert.match(html, /This update has been withdrawn/);
  }
});

test("production connected refusal precedes props route query and private-store observation", async () => {
  for (const mode of ["production", "test", undefined]) for (const props of [null, undefined, new Proxy({}, { get() { assert.fail("Production must refuse before props"); } })]) {
    const h = harness(mode); await refused(h, props);
  }
});

test("trusted installed Next query and params interrupts preserve their identity and unwrap the real cause", async () => {
  for (const signal of [() => navigation.notFound(), () => navigation.redirect("/editorial-preview"), () => navigation.permanentRedirect("/connected-preview/overview")]) {
    let expected; try { signal(); } catch (error) { expected = error; } assert.ok(expected);
    for (const field of ["params", "searchParams"]) for (const wrapped of [false, true]) {
      const h = harness(), props = input(); props[field] = Promise.reject(wrapped ? Error("PRIVATE_CANARY", { cause: expected }) : expected);
      await assert.rejects(h.Page(props), error => error === expected); assert.deepEqual(h.calls, []); assert.equal(h.factories, 0);
    }
  }
});

test("connected store rejection remains outside selector recovery without retrying or replacing the exception", async () => {
  const error = Error("PRIVATE_CANARY"), h = harness("development", error);
  await assert.rejects(h.render(input("issue", { edition: "2" })), observed => observed === error);
  assert.deepEqual(h.calls, [2]); assert.equal(h.factories, 1);
});

test("known invalid connected view refuses before touching an unrelated unfinished search port", async () => {
  const h = harness(); let reads = 0, awaits = 0;
  await refused(h, { params: Promise.resolve({ view: "unsupported" }), get searchParams() { reads++; return { then() { awaits++; } }; } });
  assert.equal(reads, 0); assert.equal(awaits, 0);
});
