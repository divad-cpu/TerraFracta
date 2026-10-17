import { createHash } from "node:crypto";
import { z } from "zod";
import { publicSourceUrl } from "../public-issue-projection.ts";
import { schemaCheckedUtcMicroseconds as micros } from "../exact-utc-observation.ts";

// Closed supplied-report consistency only. Original PDF bytes are omitted;
// neither their hash nor extraction, source authority or rights is verified.
const scalar = (s: string) => !/[\ud800-\udfff]/u.test(s);
const boundarySpace = /^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/u;
const nonblank = /[^\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/u;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.iso.datetime().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/).refine(s => !s.startsWith("0000-"));
const itemKey = z.string().min(1).max(120).refine(s => scalar(s) && !boundarySpace.test(s) && !/[\u0000-\u001f]/u.test(s));
const text = z.string().refine(s => scalar(s) && nonblank.test(s) &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(s) && Buffer.byteLength(s, "utf8") <= 8192);
const document = z.strictObject({
  source_key: z.string().regex(/^[a-z0-9][a-z0-9:-]{0,119}$/), item_key: itemKey,
  source_version_id: z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/),
  source_url: publicSourceUrl.refine(scalar), content_sha256: hash,
  retrieved_at: instant, media_type: z.literal("application/pdf"),
});
const limits = z.strictObject({
  max_input_bytes: z.literal(65536), max_pages: z.literal(8), max_main_content_bytes: z.literal(1048576),
  max_page_text_bytes: z.literal(8192), max_total_text_bytes: z.literal(65536), max_output_bytes: z.literal(131072),
  wall_seconds: z.literal(3), cpu_seconds: z.literal(2), address_space_bytes: z.literal(268435456),
  core_bytes: z.literal(0), file_bytes: z.literal(0),
});
const page = z.discriminatedUnion("state", [
  z.strictObject({ page_number: z.number().int().min(1).max(8), state: z.literal("text_extracted"), text,
    text_sha256: hash, reason_code: z.null() }),
  z.strictObject({ page_number: z.number().int().min(1).max(8), state: z.literal("no_native_text"),
    text: z.null(), text_sha256: z.null(), reason_code: z.null() }),
  z.strictObject({ page_number: z.number().int().min(1).max(8), state: z.literal("held"), text: z.null(), text_sha256: z.null(),
    reason_code: z.enum(["page_content_limit", "page_text_limit", "page_text_unusable", "page_extraction_unavailable"]) }),
]);
const schema = z.strictObject({ schema_version: z.literal(1), kind: z.literal("private_pdf_text_inspection"),
  scope: z.literal("native_pdf_page_text_only_unverified"), document, observed_at: instant,
  original_bytes: z.number().int().min(1).max(65536), parser_identity: z.literal("pypdf/6.21.0:strict:plain"), limits,
  state: z.enum(["inspected", "held"]), reason_code: z.enum(["pdf_encrypted", "pdf_parse_unavailable", "pdf_page_limit", "pdf_output_limit"]).nullable(),
  page_count: z.number().int().min(1).max(8).nullable(), pages: z.array(page).max(8),
});
export type PdfInspectionReport = z.infer<typeof schema>;

// Snapshot bounded JSON data properties once. Reflection/accessor faults,
// symbols, holes and private extra array keys are not report contents.
function suppliedJson(value: unknown, depth = 0, budget = { nodes: 0 }): unknown {
  if (++budget.nodes > 200 || depth > 6) throw Error();
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") { if (value.length > 131072) throw Error(); return value; }
  if (typeof value !== "object") throw Error();
  const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw Error();
  const keys = Reflect.ownKeys(value);
  if (keys.some(k => typeof k !== "string") || keys.length > 16) throw Error();
  const out: Record<string, unknown> | unknown[] = array ? [] : {};
  const count = array ? Object.getOwnPropertyDescriptor(value, "length")?.value : undefined;
  if (array && (typeof count !== "number" || count > 8 || keys.length !== count + 1 ||
      keys.some(k => k !== "length" && !/^(0|[1-7])$/.test(String(k))))) throw Error();
  for (const key of keys) {
    if (array && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw Error();
    Object.defineProperty(out, key, { value: suppliedJson(descriptor.value, depth + 1, budget), enumerable: true, configurable: true, writable: true });
  }
  if (array && (out as unknown[]).length !== count || JSON.stringify(Reflect.ownKeys(value)) !== JSON.stringify(keys)) throw Error();
  return out;
}

export function pdfInspectionReport(input: unknown): PdfInspectionReport | null {
  try {
    const report = schema.parse(suppliedJson(input));
    if (Buffer.byteLength(JSON.stringify(report), "utf8") + 1 > 131072 || micros(report.document.retrieved_at) > micros(report.observed_at)) return null;
    if (report.state === "held") return report.page_count === null && report.pages.length === 0 && report.reason_code !== null ? report : null;
    if (report.reason_code !== null || report.page_count !== report.pages.length || report.pages.length === 0) return null;
    let total = 0;
    for (const [index, p] of report.pages.entries()) {
      if (p.page_number !== index + 1) return null;
      if (p.state === "text_extracted") {
        total += Buffer.byteLength(p.text, "utf8");
        if (createHash("sha256").update(p.text, "utf8").digest("hex") !== p.text_sha256) return null;
      }
    }
    return total <= 65536 ? report : null;
  } catch { return null; }
}
