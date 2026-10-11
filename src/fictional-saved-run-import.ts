import { copyNativeArrayBuffer } from "./native-byte-chunk.ts";
import { localResponseBytes } from "./local-response-json.ts";
import { fictionalUpdateResultSchema, type FictionalUpdateResult } from "./fictional-update-result.ts";

// Allow formatting around the existing 64 KiB receipt; neither a file nor its
// metadata can choose a larger allocation or an operational result contract.
export const SAVED_RUN_FILE_BYTE_LIMIT = 2 * localResponseBytes.update;

export function readFictionalSavedRun(bytes: ArrayBuffer, expectedBytes?: number): FictionalUpdateResult {
  const owned = new Uint8Array(SAVED_RUN_FILE_BYTE_LIMIT);
  const size = copyNativeArrayBuffer(owned, bytes);
  if (size < 2 || (expectedBytes !== undefined &&
      (!Number.isSafeInteger(expectedBytes) || expectedBytes !== size))) throw new Error("Saved fictional file refused");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(owned.subarray(0, size));
  const result = fictionalUpdateResultSchema.parse(JSON.parse(text));
  if (new TextEncoder().encode(JSON.stringify(result) + "\n").byteLength > localResponseBytes.update)
    throw new Error("Saved fictional receipt refused");
  return result;
}
