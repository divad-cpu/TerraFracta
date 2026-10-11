import { fictionalUpdateResultSchema } from "./fictional-update-result.ts";

// Preserve one checked historical rehearsal, including its held decisions and
// exact execution/source identities. No upload, archive write or live authority.
export function exportFictionalSavedRun(input: unknown): string {
  return JSON.stringify(fictionalUpdateResultSchema.parse(input), null, 2) + "\n";
}
