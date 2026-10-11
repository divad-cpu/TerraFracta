import { copyNativeArrayBuffer } from "./native-byte-chunk.ts";
import { z } from "zod";
import { weeklyRehearsalObservationSchema } from "./weekly-rehearsal-status.ts";
import { exportWeeklyRehearsal } from "./weekly-rehearsal-export.ts";

export const WEEKLY_REPORT_BYTE_LIMIT = 16 * 1024;
const reportSchema = z.strictObject({ schemaVersion: z.literal(1), artifactKind: z.literal("fictional_weekly_rehearsal_status"),
  historicalObservation: z.literal(true), observation: weeklyRehearsalObservationSchema, limitation: z.string().max(300),
}).superRefine((value, context) => {
  const expected = JSON.parse(exportWeeklyRehearsal({ state: "observed", observation: value.observation }).body);
  if (value.limitation !== expected.limitation) context.addIssue({ code: "custom", message: "Historical report limitation differs" });
});
export type WeeklyRehearsalReport = z.infer<typeof reportSchema>;
export function readWeeklyRehearsalReport(bytes: ArrayBuffer, expectedSize?: number): WeeklyRehearsalReport {
  if (!(bytes instanceof ArrayBuffer)) throw new Error("Local assessment size refused");
  // A File adapter cannot choose the quota through an own byteLength property.
  const owned = new Uint8Array(WEEKLY_REPORT_BYTE_LIMIT);
  const size = copyNativeArrayBuffer(owned, bytes);
  if (size < 2 || (expectedSize !== undefined && size !== expectedSize)) throw new Error("Local assessment size refused");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(owned.subarray(0, size));
  return reportSchema.parse(JSON.parse(text));
}
