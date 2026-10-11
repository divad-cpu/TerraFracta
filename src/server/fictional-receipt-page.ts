import { createHash } from "node:crypto";
import { z } from "zod";
import { fictionalUpdateResultSchema } from "../fictional-update-result.ts";
import { compareFictionalExecutionNewestFirst } from "../fictional-execution-order.ts";
import { FICTIONAL_HISTORY_PAGE_SIZE, fictionalHistoryRequestSelection, fictionalReceiptPageSchema } from "../fictional-receipt-page.ts";
import { hasLocalDevelopmentAuthority } from "./local-development-request.ts";
import { readAllFictionalReceipts } from "./fictional-receipt-store.ts";
import { observeDevelopmentError, recordDevelopmentError, type DevelopmentErrorRecorder } from "./error-diagnostics.ts";

const inventorySchema = z.strictObject({ entries: z.array(fictionalUpdateResultSchema).max(100), totalReceipts: z.number().int().min(0).max(100),
  unreadableReceipts: z.number().int().min(0).max(100), pendingReceipts: z.number().int().min(0).max(100), stableSnapshot: z.boolean(),
}).refine(value => value.entries.length === value.totalReceipts - value.unreadableReceipts && value.totalReceipts + value.pendingReceipts <= 100 &&
  new Set(value.entries.map(row => row.execution.id)).size === value.entries.length);
const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
export async function handleFictionalHistoryPageRequest(request: Request, environment: string | undefined,
  read = readAllFictionalReceipts, record: DevelopmentErrorRecorder = recordDevelopmentError): Promise<Response> {
  const fail = (status: number, error: string) => Response.json({ error }, { status, headers });
  if (environment !== "development") return fail(404, "not_found");
  if (request.method !== "GET") return fail(405, "method_not_allowed");
  if (!hasLocalDevelopmentAuthority(request, false)) return fail(403, "local_origin_required");
  const selected = fictionalHistoryRequestSelection(new URL(request.url).searchParams);
  if (!selected) return fail(400, "invalid_fictional_history_selection");
  if (request.signal.aborted) return fail(409, "request_cancelled");
  try {
    const inventory = inventorySchema.parse(await read());
    const entries = [...inventory.entries].sort(compareFictionalExecutionNewestFirst);
    // A comparison token for this validated bounded inventory, never a filename,
    // authentication credential or an atomic/complete filesystem guarantee.
    const snapshotToken = createHash("sha256").update(JSON.stringify({ ...inventory, entries })).digest("hex");
    if (selected.snapshot !== null && (!inventory.stableSnapshot || selected.snapshot !== snapshotToken)) return fail(409, "fictional_history_changed");
    const matching = entries.filter(row => (!selected.selection.scenario || row.execution.scenario === selected.selection.scenario) && (!selected.selection.trigger || row.report.trigger === selected.selection.trigger));
    const pages = Math.max(1, Math.ceil(matching.length / FICTIONAL_HISTORY_PAGE_SIZE));
    if (selected.selection.page > pages) return fail(400, "fictional_history_page_unavailable");
    const start = (selected.selection.page - 1) * FICTIONAL_HISTORY_PAGE_SIZE;
    const output = fictionalReceiptPageSchema.parse({ ...inventory, entries: matching.slice(start, start + FICTIONAL_HISTORY_PAGE_SIZE),
      schemaVersion: 1, archiveKind: "local_fictional_receipt_page", capacity: 100, snapshotToken, selection: selected.selection, matchingReceipts: matching.length, pages });
    if (request.signal.aborted) return fail(409, "request_cancelled");
    return Response.json(output, { headers });
  } catch { observeDevelopmentError("server_route", record); return fail(503, "fictional_history_unavailable"); }
}
