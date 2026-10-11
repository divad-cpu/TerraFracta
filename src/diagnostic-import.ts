import { copyNativeArrayBuffer } from "./native-byte-chunk.ts";
import { parseDiagnosticReport, type DiagnosticReport } from "./diagnostic-report.ts";

// One complete 1,001-entry pretty-printed export fits inside this fixed bound.
// No filenames, external references, uploads or arbitrary text are returned.
export const DIAGNOSTIC_IMPORT_BYTES = 768 * 1024;
export function readDiagnosticExport(bytes: ArrayBuffer, expectedSize?: number): DiagnosticReport {
  if (!(bytes instanceof ArrayBuffer)) throw new Error("Diagnostic export size refused");
  // A File adapter cannot choose the quota through an own byteLength property.
  const owned = new Uint8Array(DIAGNOSTIC_IMPORT_BYTES);
  const size = copyNativeArrayBuffer(owned, bytes);
  if (size < 2 || (expectedSize !== undefined && expectedSize !== size)) throw new Error("Diagnostic export size refused");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(owned.subarray(0, size));
  return parseDiagnosticReport(JSON.parse(text));
}
