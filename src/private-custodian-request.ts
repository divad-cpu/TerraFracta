import { discardLocalResponse, localResponseBytes, readLocalResponseJson } from "./local-response-json.ts";
import { parsePrivateCustodianOperationStatus, type PrivateCustodianOperationStatus } from "./private-custodian-operation.ts";
import { withLocalRequestDeadline } from "./local-request-deadline.ts";
import { observeClientError } from "./client-error-diagnostics.ts";

// A browser timeout cancels only its status request. The accepted fixed server
// attempt continues and can be inspected after reloading; POST is never retried.
export async function requestPrivateCustodianStatus(method: "GET" | "POST", signal: AbortSignal,
  onDeadline?: () => void): Promise<PrivateCustodianOperationStatus> {
  let deadlineElapsed = false;
  try { return await withLocalRequestDeadline(signal, 5_000, async (active) => {
    const response = await fetch("/api/dev/private-custodian", { method, cache: "no-store", signal: active,
      ...(method === "POST" ? { headers: { "content-type": "application/json" },
        body: '{"action":"run_invented_custodian"}' } : {}) });
    if (!response.ok) { discardLocalResponse(response); throw new Error("Local test status unavailable"); }
    return parsePrivateCustodianOperationStatus(await readLocalResponseJson(response, active, localResponseBytes.custodian));
  }, undefined, () => { deadlineElapsed = true; onDeadline?.(); }); } catch (error) {
    if (!signal.aborted && !deadlineElapsed) observeClientError("custodian_request");
    throw error;
  }
}
