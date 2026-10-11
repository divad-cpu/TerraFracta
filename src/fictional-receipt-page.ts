import { z } from "zod";
import { fictionalUpdateResultSchema } from "./fictional-update-result.ts";
import { compareFictionalExecutionNewestFirst } from "./fictional-execution-order.ts";

export const FICTIONAL_HISTORY_PAGE_SIZE = 8;
const scenario = z.enum(["", "standard", "missing_source", "invalid_citation", "revised_value"]);
const trigger = z.enum(["", "manual", "scheduled"]);
export const fictionalHistorySelectionSchema = z.strictObject({ page: z.number().int().min(1).max(13), scenario, trigger });
export type FictionalHistorySelection = z.infer<typeof fictionalHistorySelectionSchema>;
export const emptyFictionalHistorySelection: FictionalHistorySelection = { page: 1, scenario: "", trigger: "" };

export function fictionalHistoryRequestSelection(parameters: URLSearchParams) {
  const allowed = ["page", "scenario", "trigger", "snapshot"];
  for (const key of parameters.keys()) if (!allowed.includes(key) || parameters.getAll(key).length !== 1) return null;
  const page = parameters.get("page") ?? "1", snapshot = parameters.get("snapshot");
  if (!/^[1-9][0-9]?$/.test(page) || (snapshot !== null && !/^[0-9a-f]{64}$/.test(snapshot))) return null;
  const result = fictionalHistorySelectionSchema.safeParse({ page: Number(page), scenario: parameters.get("scenario") ?? "", trigger: parameters.get("trigger") ?? "" });
  return result.success ? { selection: result.data, snapshot } : null;
}
export function fictionalHistoryPageHref(selection: FictionalHistorySelection, snapshot?: string) {
  const checked = fictionalHistorySelectionSchema.parse(selection), query = new URLSearchParams();
  if (checked.page !== 1) query.set("page", String(checked.page));
  if (checked.scenario) query.set("scenario", checked.scenario);
  if (checked.trigger) query.set("trigger", checked.trigger);
  if (snapshot !== undefined) query.set("snapshot", z.string().regex(/^[0-9a-f]{64}$/).parse(snapshot));
  return `/api/dev/update-rehearsal/history/page${query.size ? `?${query}` : ""}`;
}
export const fictionalReceiptPageSchema = z.strictObject({
  schemaVersion: z.literal(1), archiveKind: z.literal("local_fictional_receipt_page"), capacity: z.literal(100),
  totalReceipts: z.number().int().min(0).max(100), unreadableReceipts: z.number().int().min(0).max(100), pendingReceipts: z.number().int().min(0).max(100),
  stableSnapshot: z.boolean(), snapshotToken: z.string().regex(/^[0-9a-f]{64}$/),
  selection: fictionalHistorySelectionSchema, matchingReceipts: z.number().int().min(0).max(100), pages: z.number().int().min(1).max(13),
  entries: z.array(fictionalUpdateResultSchema).max(FICTIONAL_HISTORY_PAGE_SIZE),
}).superRefine((value, context) => {
  const offset = (value.selection.page - 1) * FICTIONAL_HISTORY_PAGE_SIZE;
  const invalid = value.totalReceipts + value.pendingReceipts > value.capacity || value.unreadableReceipts > value.totalReceipts ||
    value.matchingReceipts > value.totalReceipts - value.unreadableReceipts ||
    value.pages !== Math.max(1, Math.ceil(value.matchingReceipts / FICTIONAL_HISTORY_PAGE_SIZE)) || value.selection.page > value.pages ||
    value.entries.length !== Math.min(FICTIONAL_HISTORY_PAGE_SIZE, Math.max(0, value.matchingReceipts - offset)) ||
    new Set(value.entries.map(row => row.execution.id)).size !== value.entries.length ||
    value.entries.some(row => (value.selection.scenario && row.execution.scenario !== value.selection.scenario) || (value.selection.trigger && row.report.trigger !== value.selection.trigger)) ||
    value.entries.some((row, index) => index > 0 && compareFictionalExecutionNewestFirst(value.entries[index - 1], row) > 0);
  if (invalid) context.addIssue({ code: "custom", message: "Fictional receipt page is inconsistent" });
});
export type FictionalReceiptPage = z.infer<typeof fictionalReceiptPageSchema>;
