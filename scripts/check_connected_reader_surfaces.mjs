import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { connectedFictionalStore } from "../src/server/connected-fictional-store.ts";
import { connectedStatusIdentity, interpretConnectedStatus } from "../src/connected-reader-status.ts";
import { startConnectedReaderWatch } from "../src/connected-reader-watch.ts";
import { handleConnectedReaderStatus } from "../src/server/connected-reader-status.ts";
import * as correctionFields from "../src/correction-target.ts";
import * as correctionContext from "../src/connected-correction-draft.ts";
import * as correctionRequests from "../src/correction-request.ts";

// Pure in-process server markup check, not browser/HTTP access or deployed
// visibility acceptance. Reads the same fixed local store as the dev page.
if (process.argv.length !== 2) throw new Error("The fixed connected surface checker accepts no arguments");
const sourcePath = new URL("../src/connected-preview-view.tsx", import.meta.url);
const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
const correctionPath = new URL("../app/corrections/draft-form.tsx", import.meta.url), correctionExports = {};
const correctionCode = ts.transpileModule(readFileSync(correctionPath, "utf8"), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const correctionRequire = createRequire(correctionPath);
const correctionImports = { "../../src/correction-target": correctionFields, "../../src/connected-correction-draft": correctionContext, "../../src/correction-request": correctionRequests };
new Function("require", "exports", correctionCode)(name => correctionImports[name] ?? correctionRequire(name), correctionExports);
const sourceRequire = createRequire(sourcePath);
new Function("require", "exports", compiled)(name => name === "../app/corrections/draft-form" ? correctionExports : sourceRequire(name), exports);
const outcome = await connectedFictionalStore().current();
if (outcome.kind !== "snapshot") throw new Error("Connected reader is empty or unavailable");
const snapshot = outcome.snapshot;
const statusRequest = (edition) => new Request("http://127.0.0.1:3100/api/dev/connected-reader", {
  headers: { "sec-fetch-site": "same-origin", "x-terrafracta-edition": String(edition) },
});
// These are direct in-process function calls, not HTTP or browser requests.
const status = await handleConnectedReaderStatus(statusRequest(snapshot.generation), "development");
if (status.status !== 200 || status.headers.get("cache-control") !== "no-store" ||
    interpretConnectedStatus(await status.json(), connectedStatusIdentity(snapshot)).kind !== "current") {
  throw new Error("Actual file-backed current-edition status differs");
}
let olderEditionWithheld = null;
if (snapshot.generation > 1) {
  const previous = await handleConnectedReaderStatus(statusRequest(snapshot.generation - 1), "development");
  const payload = await previous.json();
  if (previous.status !== 200 || payload.kind !== "changed" || payload.currentGeneration !== snapshot.generation) throw new Error("Older file-backed edition was accepted");
  olderEditionWithheld = true;
}
const clientPath = new URL("../app/connected-preview/CurrentConnectedEdition.tsx", import.meta.url);
const clientCode = ts.transpileModule(readFileSync(clientPath, "utf8"), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const clientExports = {}, nativeRequire = createRequire(clientPath);
new Function("require", "exports", clientCode)((name) => name.endsWith("connected-reader-watch") ? { startConnectedReaderWatch } : nativeRequire(name), clientExports);
const surfaces = exports.connectedViews.map((view) => {
  const content = createElement(exports.ConnectedPreviewView, { outcome, view, query: "fictional" });
  const html = renderToStaticMarkup(createElement(clientExports.CurrentConnectedEdition, { expected: connectedStatusIdentity(snapshot) }, content));
  if (!html.includes(`data-connected-edition="${snapshot.generation}"`)) throw new Error("Rendered edition differs");
  if (snapshot.state === "active") {
    if (!html.includes(snapshot.issue.claims[0].assertion) || !html.includes(`data-publication-id="${snapshot.issue.publicationId}"`)) {
      throw new Error("Surface does not contain the current claim/publication");
    }
  } else if (!html.includes("This update has been withdrawn") || /(?:27\.4|28\.1)%/.test(html) || html.includes("example.org/fictional-table")) {
    throw new Error("Withdrawn data survived a surface");
  }
  return { view, sha256: createHash("sha256").update(html).digest("hex"), bytes: Buffer.byteLength(html), html };
});
process.stdout.write(JSON.stringify({
  evidenceKind: "actual_in_process_connected_server_markup", generation: snapshot.generation,
  state: snapshot.state, publicationId: snapshot.state === "active" ? snapshot.issue.publicationId : null,
  surfaces, browserVerified: false, hostedVisibilityVerified: false,
  actualFileBackedStatusVerified: true, olderEditionWithheld, clientInitialServerRenderVerified: true, clientPollingRuntimeVerified: false,
}) + "\n");
