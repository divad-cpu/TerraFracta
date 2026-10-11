import { copyNativeByteChunk } from "../native-byte-chunk.ts";

// Fixed worker stdout must remain bytes until strict decoding. Native execFile
// string decoding replaces invalid UTF-8 before JSON/schema validation can see it.
export function parseNativeWorkerJson(output: unknown, bytesLimit: number): unknown {
  const bytes = new Uint8Array(bytesLimit);
  const size = copyNativeByteChunk(bytes, 0, output);
  // Keep the prior JSON.parse refusal of an initial BOM; valid U+FFFD remains
  // ordinary data, distinct from silently replacing an invalid byte sequence.
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
    .decode(bytes.subarray(0, size));
  return JSON.parse(text);
}
