import { createHash } from "node:crypto";
import { z } from "zod";
import { publicSourceUrl } from "../public-issue-projection.ts";
import { schemaCheckedUtcMicroseconds as micros } from "../exact-utc-observation.ts";

// Server-side consistency checks over a closed report. No storage/transport
// authentication and no recomputation of omitted original/request/output bytes.
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const scalar = (s: string) => !/[\ud800-\udfff]/u.test(s);
const bounded = (n: number) => z.string().refine(s => scalar(s) && [...s].length > 0 && [...s].length <= n &&
  !/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/.test(s) && !/[\u0000-\u0008\u000b-\u001f]/.test(s));
const passage = z.string().refine(s => /[^\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/u.test(s) && scalar(s) && Buffer.byteLength(s, "utf8") > 0 && Buffer.byteLength(s, "utf8") <= 8192 && !s.includes("\0"));
const instant = z.iso.datetime().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/).refine(s => !s.startsWith("0000-"));
const identity = bounded(200).refine(s => !/[\u0000-\u001f]/.test(s));
const source = z.strictObject({ operation_id: uuid, artifact_id: uuid, stored_at: instant,
  source_key: bounded(120).regex(/^fictional-[a-z0-9:-]{1,109}$/), item_key: bounded(120).refine(s => !/[\u0000-\u001f]/.test(s)), source_version_id: uuid,
  source_url: publicSourceUrl.refine(scalar).refine(s => { const u = new URL(s); return u.protocol === "https:" && u.hostname === "example.org" && !u.username && !u.password && !u.search && !u.hash && !u.port; }),
  content_sha256: hash, mapping_sha256: hash, language_code: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/), retrieved_at: instant });
const schema = z.strictObject({ schema_version: z.literal(1), kind: z.literal("private_extraction_review_report"),
  review_state: z.literal("unverified"), scope: z.literal("invented_offline_rehearsal_only"), prepared_at: instant, observed_at: instant,
  artifact: z.strictObject({ operation_id: uuid, artifact_id: uuid, stored_at: instant, output_sha256: hash }),
  request: z.strictObject({ request_sha256: hash, selected_payload_sha256: hash, maximum_output_tokens: z.number().int().min(1).max(1000000), maximum_output_bytes: z.literal(8192) }),
  current: source, previous: source,
  selected_passages: z.array(z.strictObject({ text: passage, text_sha256: hash, locators: z.array(identity).min(1).max(128),
    earlier: z.array(z.strictObject({ locator: identity, text: passage.nullable(), text_sha256: hash.nullable() })).min(1).max(128) })).min(1).max(128),
  proposal: z.strictObject({ source_version_id: uuid, source_sha256: hash, locator: identity,
    proposed_claim_type: z.enum(["condition", "policy_action", "funding", "delivery", "attributed_finding", "evaluation"]),
    proposed_assertion: bounded(600).refine(s => [...s].length >= 10), source_date_text: bounded(80).nullable(), language_code: source.shape.language_code, review_state: z.literal("unverified") }),
  context: z.strictObject({ current_publication: z.literal("not_connected"), affected_pages: z.literal("not_connected"), held_decision: z.literal("not_connected"),
    conflict_assessment: z.literal("not_recorded"), translation_assessment: z.literal("not_recorded"), factual_support: z.literal("not_assessed"),
    provider_usage: z.literal("not_observed"), actual_cost: z.literal("not_observed") }) });
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export function privateExtractionReport(input: unknown) {
  try {
    const r = schema.parse(input), { current: c, previous: p } = r;
    if (Buffer.byteLength(JSON.stringify(r), "utf8") > 262144 ||
      ["source_key", "item_key", "source_url", "mapping_sha256", "language_code"].some(k => c[k as keyof typeof c] !== p[k as keyof typeof p]) ||
      c.operation_id === p.operation_id || c.artifact_id === p.artifact_id || c.source_version_id === p.source_version_id ||
      c.content_sha256 === p.content_sha256 ||
      micros(c.retrieved_at) < micros(p.retrieved_at) || [c,p].some(s => micros(s.retrieved_at) > micros(s.stored_at) || micros(s.stored_at) > micros(r.prepared_at)) ||
      micros(r.prepared_at) > micros(r.artifact.stored_at) || micros(r.artifact.stored_at) > micros(r.observed_at) ||
      r.proposal.source_version_id !== c.source_version_id || r.proposal.source_sha256 !== c.content_sha256 || r.proposal.language_code !== c.language_code) return null;
    const locators = new Set<string>(), texts = new Set<string>(); let total = 0, previousTotal = 0;
    for (const group of r.selected_passages) {
      total += Buffer.byteLength(group.text, "utf8") * group.locators.length;
      if (sha(group.text) !== group.text_sha256 || texts.has(group.text) || group.earlier.length !== group.locators.length) return null;
      texts.add(group.text);
      for (const [i, locator] of group.locators.entries()) {
        const old = group.earlier[i];
        previousTotal += old.text === null ? 0 : Buffer.byteLength(old.text, "utf8");
        if (locators.has(locator) || old.locator !== locator || (old.text === null ? old.text_sha256 !== null :
          old.text_sha256 !== sha(old.text) || old.text === group.text)) return null;
        locators.add(locator);
      }
    }
    if (locators.size > 128 || total > 65536 || previousTotal > 65536 || !locators.has(r.proposal.locator)) return null;
    const payload = { schema_version: 1, kind: "private_changed_passages", source_key: c.source_key, item_key: c.item_key,
      source_version_id: c.source_version_id, content_sha256: c.content_sha256, mapping_sha256: c.mapping_sha256, language_code: c.language_code,
      passages: r.selected_passages.map(({text,text_sha256,locators}) => ({text,text_sha256,locators})) };
    const encoded = JSON.stringify(payload);
    return Buffer.byteLength(encoded, "utf8") <= 65536 && sha(encoded) === r.request.selected_payload_sha256 ? r : null;
  } catch { return null; }
}
