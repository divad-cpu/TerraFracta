import { createHash } from "node:crypto";
import { z } from "zod";
import { pdfInspectionReport, type PdfInspectionReport } from "./pdf-inspection-report.ts";
import { schemaCheckedUtcMicroseconds as micros } from "../exact-utc-observation.ts";

const instant = z.iso.datetime().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/).refine(s => !s.startsWith("0000-"));
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const schema = z.strictObject({ schema_version: z.literal(1), kind: z.literal("private_pdf_packet_reopen_report"),
  scope: z.literal("supplied_unverified_pdf_packet_rederivation_only"), packet_sha256: hash,
  inspection_sha256: hash, derivation_sha256: hash, recorded_observed_at: instant, reopened_at: instant,
  inspection_report: z.unknown(),
});
const keys = new Set(["schema_version", "kind", "scope", "packet_sha256", "inspection_sha256", "derivation_sha256",
  "recorded_observed_at", "reopened_at", "inspection_report"]);
export type PdfPacketReopenReport = Omit<z.infer<typeof schema>, "inspection_report"> & { inspection_report: PdfInspectionReport };

// Observe only closed enumerable data properties. The existing inner consumer
// snapshots every nested field before validation; no accessor is called here.
function outerSnapshot(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw Error();
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) throw Error();
  const names = Reflect.ownKeys(input);
  if (names.length !== keys.size || names.some(k => typeof k !== "string" || !keys.has(k))) throw Error();
  const out: Record<string, unknown> = Object.create(null);
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(input, name);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw Error();
    Object.defineProperty(out, name, { value: descriptor.value, enumerable: true });
  }
  if (JSON.stringify(Reflect.ownKeys(input)) !== JSON.stringify(names)) throw Error();
  return out;
}

export function pdfPacketReopenReport(input: unknown): PdfPacketReopenReport | null {
  try {
    const outer = schema.parse(outerSnapshot(input));
    const inspection = pdfInspectionReport(outer.inspection_report);
    // A whole-held document cannot be a prepared/reopened passage packet.
    if (!inspection || inspection.state !== "inspected" || outer.recorded_observed_at !== inspection.observed_at ||
        micros(outer.reopened_at) < micros(outer.recorded_observed_at)) return null;
    // The existing strict parser rebuilds the fixed Python _encode field order.
    // All numeric fields are bounded integers; scalar Unicode is already checked.
    // This checks supplied report bytes in that compact UTF-8 + LF wire profile,
    // not the omitted packet/PDF/manifest or whether a worker actually ran.
    const wire = JSON.stringify(inspection) + "\n";
    if (createHash("sha256").update(wire, "utf8").digest("hex") !== outer.inspection_sha256) return null;
    const report = { ...outer, inspection_report: inspection };
    return Buffer.byteLength(JSON.stringify(report), "utf8") + 1 <= 132096 ? report : null;
  } catch { return null; }
}
