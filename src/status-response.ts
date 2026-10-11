import { discardLocalResponse, localResponseBytes, readLocalResponseJson } from "./local-response-json.ts";

// Shared existing current-publication status budget, also used by the local
// connected example. No source approval or deployed service is established.
export async function readStatusResponse(response: Response, signal: AbortSignal): Promise<unknown> {
  if (response.status !== 200) { discardLocalResponse(response); throw new Error("Current status unavailable"); }
  try { return await readLocalResponseJson(response, signal, localResponseBytes.status); }
  catch { throw new Error("Current status unavailable"); }
}
