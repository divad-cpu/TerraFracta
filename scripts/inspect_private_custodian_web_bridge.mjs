// Fixed read-only status inspection in a distinct app process. No HTTP server.
import assert from "node:assert/strict";
import { createPrivateCustodianHandler } from "../src/server/private-custodian-operation.ts";
import { parsePrivateCustodianOperationStatus } from "../src/private-custodian-operation.ts";

if (process.argv.length !== 2) throw new Error("Fixed retained bridge inspection accepts no arguments");
const request = new Request("http://127.0.0.1:3000/api/dev/private-custodian", { method: "GET",
  headers: { origin: "http://127.0.0.1:3000" } });
const response = await createPrivateCustodianHandler()(request, "development");
assert.equal(response.status, 200);
const status = parsePrivateCustodianOperationStatus(await response.json());
assert.equal(status.state, "checked");
console.log(JSON.stringify(status));
