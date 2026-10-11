import { connectedEdition, type ConnectedReaderOutcome } from "../connected-fictional-reader.ts";
import { connectedStatusPayload } from "../connected-reader-status.ts";
import { connectedFictionalStore } from "./connected-fictional-store.ts";
import { hasLocalDevelopmentOrigin } from "./local-development-request.ts";

const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const failure = (status: number, error: string) => Response.json({ error }, { status, headers });
type Read = (edition: number) => Promise<ConnectedReaderOutcome>;

// Read-only development metadata. No claim, source, file path, owner account,
// SQL, collection, raw storage or publication operation is exposed.
export async function handleConnectedReaderStatus(request: Request, environment: string | undefined,
  read: Read = (edition) => connectedFictionalStore().current(edition)): Promise<Response> {
  if (environment !== "development") return failure(404, "not_found");
  if (request.method !== "GET") return failure(405, "method_not_allowed");
  if (!hasLocalDevelopmentOrigin(request, false)) return failure(403, "local_origin_required");
  if (new URL(request.url).pathname !== "/api/dev/connected-reader") return failure(400, "invalid_status_request");
  const unavailable = () => Response.json({ schemaVersion: 1, kind: "unavailable" }, { status: 503, headers });
  if (request.signal.aborted) return failure(409, "request_cancelled");
  let edition: number | null;
  try { edition = connectedEdition(request.headers.get("x-terrafracta-edition")); } catch { return failure(400, "invalid_edition"); }
  if (edition === null) return failure(400, "invalid_edition");
  const cancellation = Symbol();
  let cancel: () => void = () => {};
  const cancelled = new Promise<typeof cancellation>(resolve => { cancel = () => resolve(cancellation); });
  request.signal.addEventListener("abort", cancel, { once: true });
  if (request.signal.aborted) cancel();
  try {
    // The caller may leave while the bounded file inspection still completes.
    // Its late success/failure stays consumed; no old identity is re-exposed.
    const work = Promise.resolve().then<ConnectedReaderOutcome | typeof cancellation>(() => request.signal.aborted ? cancellation : read(edition));
    const outcome = await Promise.race([work, cancelled]);
    if (outcome === cancellation || request.signal.aborted) return failure(409, "request_cancelled");
    const payload = connectedStatusPayload(outcome);
    if (request.signal.aborted) return failure(409, "request_cancelled");
    return Response.json(payload, { status: payload.kind === "unavailable" ? 503 : 200, headers });
  } catch {
    return request.signal.aborted ? failure(409, "request_cancelled") : unavailable();
  } finally { request.signal.removeEventListener("abort", cancel); }
}
