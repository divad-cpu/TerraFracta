import { copyNativeArrayBuffer } from "./native-byte-chunk.ts";
import { reopenScopeDraftJson, SCOPE_DRAFT_BYTES, type ScopeDraftCandidate } from "./issue-scope-draft.ts";

// Reuse intrinsic native ownership/length accounting. No file metadata can
// enlarge the allocation; the selected file's exact export remains editable
// preparation, never an authenticated review or a publication payload.
export function readScopeDraftFile(bytes: ArrayBuffer, expectedBytes: number, context: unknown): ScopeDraftCandidate | null {
  try {
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 2 || expectedBytes > SCOPE_DRAFT_BYTES) return null;
    const owned = new Uint8Array(SCOPE_DRAFT_BYTES);
    const size = copyNativeArrayBuffer(owned, bytes);
    if (size !== expectedBytes) return null;
    // Preserve a BOM so the exact export check refuses it rather than silently
    // removing bytes. Invalid UTF-8 also cannot turn into replacement wording.
    const json = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(owned.subarray(0, size));
    return reopenScopeDraftJson(json, context);
  } catch { return null; }
}
