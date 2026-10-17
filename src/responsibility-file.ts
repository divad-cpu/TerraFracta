import { copyNativeArrayBuffer } from "./native-byte-chunk.ts";
import { reopenResponsibilityDraftJson, RESPONSIBILITY_DRAFT_BYTES, type ResponsibilityDraft } from "./responsibility-draft.ts";

// Same native brand/quota/UTF-8 ownership as scope reopening, with a distinct
// canonical kind. No filename, upload, archive or authenticated-review claim.
export function readResponsibilityDraftFile(bytes: ArrayBuffer, expectedBytes: number, context: unknown): ResponsibilityDraft | null {
  try {
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 2 || expectedBytes > RESPONSIBILITY_DRAFT_BYTES) return null;
    const owned = new Uint8Array(RESPONSIBILITY_DRAFT_BYTES);
    const size = copyNativeArrayBuffer(owned, bytes);
    if (size !== expectedBytes) return null;
    return reopenResponsibilityDraftJson(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(owned.subarray(0, size)), context);
  } catch { return null; }
}
