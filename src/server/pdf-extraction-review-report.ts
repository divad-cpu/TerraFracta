import { createHash } from "node:crypto";
import { z } from "zod";
import { publicSourceUrl } from "../public-issue-projection.ts";
import { schemaCheckedUtcMicroseconds as micros } from "../exact-utc-observation.ts";

// Supplied report consistency only: omitted PDF/packets/manifests/request/output
// are not authenticated or rederived by this passive consumer.
const maximum = 384 * 1024;
const scalar = (s: string) => !/[\ud800-\udfff]/u.test(s);
const boundary = /^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/u;
const nonblank = /[^\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/u;
const ordinary = (min: number, max: number) => z.string().refine(s => scalar(s) && [...s].length >= min &&
  [...s].length <= max && !boundary.test(s) && !/[\u0000-\u0008\u000b-\u001f]/u.test(s));
const identity = (max: number) => ordinary(1, max).refine(s => !/[\u0000-\u001f]/u.test(s));
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const instant = z.iso.datetime().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/).refine(s => !s.startsWith("0000-"));
const language = z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/);
const number = z.number().int().min(1).max(8);
const locator = identity(200);
const text = z.string().refine(s => scalar(s) && nonblank.test(s) && Buffer.byteLength(s, "utf8") <= 8192 &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(s));
const page = z.strictObject({ locator, page_number: number, page_text_sha256: hash });
const source = z.strictObject({ source_key: z.string().regex(/^[a-z0-9][a-z0-9:-]{0,119}$/),
  item_key: identity(120), source_version_id: uuid, source_url: publicSourceUrl.refine(scalar), content_sha256: hash,
  retrieved_at: instant, mapping_sha256: hash, language_code: language, packet_sha256: hash,
  inspection_sha256: hash, derivation_sha256: hash, selected_pages: z.array(page).min(1).max(8) });
const earlier = z.strictObject({ locator, page_number: number, text, text_sha256: hash });
const schema = z.strictObject({ schema_version: z.literal(1), kind: z.literal("private_pdf_extraction_review_report"),
  scope: z.literal("supplied_pdf_result_rederivation_only"), review_state: z.literal("unverified"),
  recorded_observed_at: instant, prepared_at: instant, reopened_at: instant,
  artifact: z.strictObject({ operation_id: uuid, packet_sha256: hash, packet_bytes: z.number().int().min(1).max(2097152),
    output_sha256: hash, output_bytes: z.number().int().min(1).max(8192) }),
  request: z.strictObject({ request_sha256: hash, selected_payload_sha256: hash,
    request_bytes: z.number().int().min(1).max(131072), maximum_output_tokens: z.number().int().min(1).max(1000000) }),
  current: source, previous: source.nullable(),
  selected_passages: z.array(z.strictObject({ text, text_sha256: hash, locators: z.array(locator).min(1).max(8),
    page_numbers: z.array(number).min(1).max(8), earlier: z.array(earlier.nullable()).min(1).max(8) })).min(1).max(8),
  proposal: z.strictObject({ source_version_id: uuid, source_sha256: hash, locator,
    proposed_claim_type: z.enum(["condition", "policy_action", "funding", "delivery", "attributed_finding", "evaluation"]),
    proposed_assertion: ordinary(10, 600), source_date_text: ordinary(1, 80).nullable(), language_code: language,
    review_state: z.literal("unverified") }),
  context: z.strictObject({ storage: z.literal("not_observed"), source_qualification: z.literal("not_established"),
    rights: z.literal("not_established"), factual_support: z.literal("not_assessed"), conflict_assessment: z.literal("not_recorded"),
    translation_assessment: z.literal("not_recorded"), provider_usage: z.literal("not_observed"), actual_cost: z.literal("not_observed"),
    publication: z.literal("not_authorized") }),
  limits: z.strictObject({ page_index_kind: z.literal("physical_1_based"), offset_space: z.literal("derived_page_utf8"),
    whole_page_selection: z.literal(true), original_pdf_included: z.literal(false), request_body_included: z.literal(false),
    output_body_included: z.literal(false), unselected_text_included: z.literal(false), unchanged_text_included: z.literal(false),
    rendered_visibility_verified: z.literal(false), visual_qualification_established: z.literal(false),
    ocr_qualification_established: z.literal(false), table_qualification_established: z.literal(false), review_decision_included: z.literal(false) }) });
export type PdfExtractionReviewReport = z.infer<typeof schema>;
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

// Observe exact bounded own data properties; never call supplied accessors,
// array iterators/map/toJSON. Proxies remain untrusted same-process code.
function snapshot(input: unknown): unknown {
  const active = new WeakSet<object>(); let nodes = 0, bytes = 0;
  function copy(value: unknown, depth: number): unknown {
    if (++nodes > 2000 || depth > 8) throw Error();
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") { bytes += Buffer.byteLength(value, "utf8"); if (bytes > maximum) throw Error(); return value; }
    if (typeof value !== "object" || active.has(value)) throw Error();
    active.add(value);
    try {
      const array = Array.isArray(value), prototype = Object.getPrototypeOf(value), keys = Reflect.ownKeys(value);
      if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw Error();
      if (keys.length > 24 || keys.some(k => typeof k !== "string")) throw Error();
      const descriptors = Object.getOwnPropertyDescriptors(value);
      if (array) {
        const length = descriptors.length?.value;
        if (!Number.isInteger(length) || length < 0 || length > 8 || keys.length !== length + 1) throw Error();
        const result: unknown[] = [];
        for (let i = 0; i < length; i++) {
          const d = descriptors[String(i)]; if (!d?.enumerable || !("value" in d)) throw Error();
          result.push(copy(d.value, depth + 1));
        }
        if (JSON.stringify(Reflect.ownKeys(value)) !== JSON.stringify(keys)) throw Error();
        return result;
      }
      const result = Object.create(null);
      for (const k of keys) {
        const d = descriptors[k as string]; if (!d?.enumerable || !("value" in d)) throw Error();
        Object.defineProperty(result, k, { value: copy(d.value, depth + 1), enumerable: true });
      }
      if (JSON.stringify(Reflect.ownKeys(value)) !== JSON.stringify(keys)) throw Error();
      return result;
    } finally { active.delete(value); }
  }
  const result = copy(input, 0);
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > maximum) throw Error();
  return result;
}

export function pdfExtractionReviewReport(input: unknown): PdfExtractionReviewReport | null {
  try {
    const r = schema.parse(snapshot(input)), c = r.current, p = r.previous;
    if (micros(r.recorded_observed_at) > micros(r.prepared_at) || micros(r.prepared_at) > micros(r.reopened_at) ||
      [c, ...(p ? [p] : [])].some(s => micros(s.retrieved_at) > micros(r.recorded_observed_at))) return null;
    for (const s of [c, ...(p ? [p] : [])]) {
      let last = 0; const locators = new Set<string>();
      for (const v of s.selected_pages) {
        if (v.page_number <= last || locators.has(v.locator)) return null;
        locators.add(v.locator); last = v.page_number;
      }
    }
    if (p && (["source_key", "item_key", "source_url", "mapping_sha256", "language_code"].some(k => c[k as keyof typeof c] !== p[k as keyof typeof p]) ||
      micros(c.retrieved_at) < micros(p.retrieved_at) || c.content_sha256 === p.content_sha256 || c.source_version_id === p.source_version_id ||
      c.selected_pages.length !== p.selected_pages.length || c.selected_pages.some((v, i) => v.locator !== p.selected_pages[i].locator || v.page_number !== p.selected_pages[i].page_number))) return null;
    const proposal = r.proposal;
    if (proposal.source_version_id !== c.source_version_id || proposal.source_sha256 !== c.content_sha256 || proposal.language_code !== c.language_code) return null;
    const current = new Map(c.selected_pages.map(v => [v.locator, v]));
    const previous = new Map(p?.selected_pages.map(v => [v.locator, v]) ?? []);
    const changed = c.selected_pages.filter(v => !p || v.page_text_sha256 !== previous.get(v.locator)?.page_text_sha256).map(v => v.locator);
    const found = new Set<string>(), texts = new Set<string>(); let total = 0, priorTotal = 0;
    for (const g of r.selected_passages) {
      if (sha(g.text) !== g.text_sha256 || texts.has(g.text) || g.locators.length !== g.page_numbers.length || g.locators.length !== g.earlier.length) return null;
      texts.add(g.text);
      let pageOrder = 0;
      for (const [i, loc] of g.locators.entries()) {
        const now = current.get(loc), old = previous.get(loc), prior = g.earlier[i];
        if (!now || found.has(loc) || now.page_number !== g.page_numbers[i] || now.page_number <= pageOrder || now.page_text_sha256 !== g.text_sha256 || !changed.includes(loc)) return null;
        pageOrder = now.page_number; found.add(loc); total += Buffer.byteLength(g.text, "utf8");
        if (p ? !old || !prior || prior.locator !== loc || prior.page_number !== old.page_number || prior.text_sha256 !== old.page_text_sha256 || sha(prior.text) !== prior.text_sha256 || prior.text === g.text : prior !== null) return null;
        if (prior) priorTotal += Buffer.byteLength(prior.text, "utf8");
      }
    }
    if (found.size !== changed.length || !found.has(proposal.locator) || total > 65536 || priorTotal > 65536) return null;
    // Match the existing selector's fixed JSON field order, including group
    // order and all exact locator occurrences. This is selected payload bytes,
    // not the omitted complete request or raw output.
    const payload = JSON.stringify({ schema_version: 1, kind: "private_changed_passages", source_key: c.source_key,
      item_key: c.item_key, source_version_id: c.source_version_id, content_sha256: c.content_sha256,
      mapping_sha256: c.mapping_sha256, language_code: c.language_code,
      passages: r.selected_passages.map(({ text, text_sha256, locators }) => ({ text, text_sha256, locators })) });
    return Buffer.byteLength(payload, "utf8") <= 65536 && sha(payload) === r.request.selected_payload_sha256 ? r : null;
  } catch { return null; }
}

// Identical closed source/page grammar for the passive detached PDF reader.
export const pdfReviewSourceSchema = source;
