import { discardLocalResponse, localResponseBytes, readLocalResponseJson } from "./local-response-json.ts";
import { parseFictionalUpdateResult, type FictionalUpdateScenario } from "./fictional-update-result.ts";
import { withLocalRequestDeadline } from "./local-request-deadline.ts";

export class FictionalUpdateRequestError extends Error {
  readonly reason: "busy" | "archive_full" | "unconfirmed";
  constructor(reason: FictionalUpdateRequestError["reason"]) {
    super("Fictional update response is unavailable");
    this.reason = reason;
  }
}

export async function requestFictionalUpdate(trigger: "manual" | "scheduled", scenario: FictionalUpdateScenario,
  signal: AbortSignal, onDeadline?: () => void) {
  try {
    return await withLocalRequestDeadline(signal, 20_000, async (active) => {
      const response = await fetch("/api/dev/update-rehearsal", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ trigger, scenario }), signal: active, cache: "no-store",
      });
      if (response.status === 429) { discardLocalResponse(response); throw new FictionalUpdateRequestError("busy"); }
      if (!response.ok) {
        if (response.status === 503) {
          const failure = await readLocalResponseJson(response, active, localResponseBytes.refusal);
          if (failure !== null && typeof failure === "object" && "error" in failure && failure.error === "fictional_archive_full")
            throw new FictionalUpdateRequestError("archive_full");
        } else discardLocalResponse(response);
        throw new FictionalUpdateRequestError("unconfirmed");
      }
      const result = parseFictionalUpdateResult(await readLocalResponseJson(response, active, localResponseBytes.update));
      if (result.report.trigger !== trigger || result.execution.scenario !== scenario) {
        throw new FictionalUpdateRequestError("unconfirmed");
      }
      return result;
    }, undefined, onDeadline);
  } catch (error) {
    if (error instanceof FictionalUpdateRequestError) throw error;
    throw new FictionalUpdateRequestError("unconfirmed");
  }
}
