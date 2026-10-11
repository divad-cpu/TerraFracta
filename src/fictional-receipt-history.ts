import { z } from "zod";
import { fictionalUpdateResultSchema } from "./fictional-update-result.ts";

export const fictionalReceiptHistorySchema = z.strictObject({
  archiveKind: z.literal("local_fictional_receipts"),
  capacity: z.literal(100),
  totalReceipts: z.number().int().min(0).max(100),
  unreadableReceipts: z.number().int().min(0).max(100),
  pendingReceipts: z.number().int().min(0).max(100),
  entries: z.array(fictionalUpdateResultSchema).max(8),
}).superRefine((history, context) => {
  const ids = history.entries.map((entry) => entry.execution.id);
  if (new Set(ids).size !== ids.length ||
      history.entries.length > history.totalReceipts - history.unreadableReceipts ||
      history.unreadableReceipts > history.totalReceipts || history.totalReceipts + history.pendingReceipts > history.capacity) {
    context.addIssue({ code: "custom", message: "Fictional receipt inventory is inconsistent" });
  }
});

export type FictionalReceiptHistory = z.infer<typeof fictionalReceiptHistorySchema>;
