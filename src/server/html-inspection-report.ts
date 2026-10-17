import { createHash } from "node:crypto";
import { z } from "zod";
import { publicSourceUrl } from "../public-issue-projection.ts";
import { schemaCheckedUtcMicroseconds as micros } from "../exact-utc-observation.ts";

// Fixed invented preview admission. This validates the closed report, hashes
// and joins; omitted original HTML and request bytes are not rederived here.
const scalar = (s: string) => !/[\ud800-\udfff]/u.test(s);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
// Match Python str.strip(): NEL is whitespace; BOM is not. Preserve valid
// scalar metadata and parsed text rather than applying JavaScript trim rules.
const boundarySpace = /^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/u;
const nonblank = /[^\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/u;
const bounded = (max: number) => z.string().refine(s => scalar(s) && [...s].length > 0 && [...s].length <= max &&
  !boundarySpace.test(s) && !/[\u0000-\u001f]/u.test(s));
const instant = z.iso.datetime().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/).refine(s => !s.startsWith("0000-"));
const locator = bounded(200);
const elementId = z.string().regex(/^[A-Za-z][A-Za-z0-9_.:-]{0,119}$/);
const adapter = z.literal("terrafracta-selected-html-parsed-text/v1");
const parser = z.literal("stdlib.html.parser.HTMLParser:convert_charrefs=False");
const coverage = z.literal("selected_elements_parsed_text_only");
const tags = ["article", "section", "main", "div", "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "dl", "dt", "dd", "header", "footer", "nav", "address", "span", "a", "b", "strong", "i", "em", "u", "s", "small", "sub", "sup", "mark", "abbr", "cite", "q", "time", "data", "code"] as const;
const span = z.strictObject({ locator, element_id: elementId, tag: z.enum(tags),
  start: z.number().int().min(0).max(65535), end: z.number().int().min(1).max(65536),
  raw_sha256: hash, derived_text_sha256: hash });
const text = z.string().refine(s => scalar(s) && nonblank.test(s) && !/[\u0000-\u0009\u000b-\u001f\u007f]/.test(s) && Buffer.byteLength(s, "utf8") <= 8192);
const passage = span.omit({ derived_text_sha256: true }).extend({ text, text_sha256: hash });
const manifest = z.strictObject({ schema_version: z.literal(1), adapter_identity: adapter, parser_identity: parser,
  source_key: bounded(120), item_key: bounded(120), source_version_id: bounded(120), source_url: publicSourceUrl,
  content_sha256: hash, original_bytes: z.number().int().min(1).max(65536),
  retrieved_at: z.string(), mapping_sha256: hash, language_code: z.string(), coverage,
  rendered_visibility_verified: z.literal(false), spans: z.array(span).min(1).max(128) });
const source = z.strictObject({ source_key: bounded(120).regex(/^fictional-[a-z0-9:-]+$/), item_key: bounded(120),
  source_version_id: bounded(120), source_url: publicSourceUrl.refine(s => {
    const u = new URL(s); return scalar(s) && u.protocol === "https:" && u.hostname === "example.org" && !u.port && !u.username && !u.password && !u.search && !u.hash;
  }), content_sha256: hash, original_bytes: z.number().int().min(1).max(65536), retrieved_at: instant,
  mapping_sha256: hash, language_code: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/),
  adapter_identity: adapter, parser_identity: parser, derivation_manifest_json: z.string().max(131072),
  derivation_manifest_sha256: hash, passages: z.array(passage).min(1).max(128) });
const schema = z.strictObject({ schema_version: z.literal(1), kind: z.literal("private_html_inspection_report"),
  scope: z.literal("offline_supplied_html_comparison_only"), review_state: z.literal("unverified"), observed_at: instant,
  current: source, previous: source.nullable(), source_bytes_changed: z.boolean().nullable(),
  selection: z.strictObject({ state: z.enum(["ready", "no_model_work", "held"]), reason_code: bounded(80),
    unchanged_locators: z.array(locator).max(128), removed_locators: z.array(locator).max(128),
    payload_json: z.string().max(65536).nullable(), payload_sha256: hash.nullable() }),
  request: z.strictObject({ request_sha256: hash, selected_payload_sha256: hash,
    maximum_output_tokens: z.number().int().min(1).max(1000000), body_bytes: z.number().int().min(1).max(131072) }).nullable(),
  limits: z.strictObject({ coverage, rendered_visibility_verified: z.literal(false), original_html_included: z.literal(false),
    request_body_included: z.literal(false), storage: z.literal("not_observed"), source_qualification: z.literal("not_established"),
    rights: z.literal("not_established"), semantic_support: z.literal("not_assessed"), language_qualification: z.literal("not_established"),
    provider_usage: z.literal("not_observed"), publication: z.literal("not_authorized") }) });
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
// All object keys in this manifest are fixed ASCII schema keys. Canonical
// sorting matches the Python producer; source strings retain their scalars.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
type Source = z.infer<typeof source>;
function checkedSource(s: Source, observedAt: string): boolean {
  if (micros(s.retrieved_at) > micros(observedAt) || sha(s.derivation_manifest_json) !== s.derivation_manifest_sha256) return false;
  const m = manifest.parse(JSON.parse(s.derivation_manifest_json));
  const spans = s.passages.map(({ text: _text, text_sha256, ...rest }) => ({ ...rest, derived_text_sha256: text_sha256 }));
  const expected = { schema_version: 1, adapter_identity: s.adapter_identity, parser_identity: s.parser_identity,
    source_key: s.source_key, item_key: s.item_key, source_version_id: s.source_version_id, source_url: s.source_url,
    content_sha256: s.content_sha256, original_bytes: s.original_bytes, retrieved_at: s.retrieved_at.slice(0, -1) + "+00:00",
    mapping_sha256: s.mapping_sha256, language_code: s.language_code, coverage: "selected_elements_parsed_text_only",
    rendered_visibility_verified: false, spans };
  if (canonical(m) !== canonical(expected) || s.derivation_manifest_json !== canonical(expected)) return false;
  const ids = new Set<string>(), locators = new Set<string>(); let end = 0, total = 0;
  for (const p of s.passages) {
    if (p.start < end || p.end <= p.start || p.end > s.original_bytes || ids.has(p.element_id) || locators.has(p.locator) || sha(p.text) !== p.text_sha256) return false;
    ids.add(p.element_id); locators.add(p.locator); end = p.end; total += Buffer.byteLength(p.text, "utf8");
  }
  return total <= 65536;
}

export function htmlInspectionReport(input: unknown) {
  try {
    const r = schema.parse(input), c = r.current, p = r.previous;
    if (Buffer.byteLength(JSON.stringify(r), "utf8") > 262144 || !checkedSource(c, r.observed_at) ||
      (p !== null && (!checkedSource(p, r.observed_at) ||
        ["source_key", "item_key", "source_url", "mapping_sha256", "language_code", "adapter_identity", "parser_identity"].some(key => c[key as keyof Source] !== p[key as keyof Source]) ||
        micros(c.retrieved_at) < micros(p.retrieved_at) ||
        c.passages.length !== p.passages.length || c.passages.some((v, i) => v.locator !== p.passages[i].locator || v.element_id !== p.passages[i].element_id) ||
        (c.source_version_id === p.source_version_id && c.content_sha256 !== p.content_sha256) ||
        (c.content_sha256 === p.content_sha256 && (c.original_bytes !== p.original_bytes || canonical(c.passages) !== canonical(p.passages)))))) return null;
    if (r.source_bytes_changed !== (p === null ? null : c.content_sha256 !== p.content_sha256)) return null;
    const before = new Map(p?.passages.map(v => [v.locator, v]) ?? []);
    const unchanged = c.passages.filter(v => before.get(v.locator)?.text === v.text).map(v => v.locator);
    const groups = new Map<string, { text: string; text_sha256: string; locators: string[] }>();
    for (const v of c.passages) if (!unchanged.includes(v.locator)) {
      let group = groups.get(v.text);
      if (!group) { group = { text: v.text, text_sha256: v.text_sha256, locators: [] }; groups.set(v.text, group); }
      group.locators.push(v.locator);
    }
    const payload = groups.size ? JSON.stringify({ schema_version: 1, kind: "private_changed_passages",
      source_key: c.source_key, item_key: c.item_key, source_version_id: c.source_version_id,
      content_sha256: c.content_sha256, mapping_sha256: c.mapping_sha256, language_code: c.language_code,
      passages: [...groups.values()] }) : null;
    const overLimit = payload !== null && Buffer.byteLength(payload, "utf8") > 65536;
    const state = payload === null ? "no_model_work" : overLimit ? "held" : "ready";
    const reason = payload === null ? (r.source_bytes_changed === true ? "source_changed_passages_unchanged" : "passages_unchanged") : overLimit ? "passage_payload_limit" : "changed_passages";
    const admittedPayload = state === "ready" ? payload : null;
    if (r.selection.state !== state || r.selection.reason_code !== reason || r.selection.removed_locators.length !== 0 ||
      JSON.stringify(r.selection.unchanged_locators) !== JSON.stringify(unchanged) || r.selection.payload_json !== admittedPayload ||
      r.selection.payload_sha256 !== (admittedPayload === null ? null : sha(admittedPayload)) ||
      (r.request !== null && (state !== "ready" || r.request.selected_payload_sha256 !== r.selection.payload_sha256))) return null;
    return r;
  } catch { return null; }
}
