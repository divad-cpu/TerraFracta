import { z } from "zod";
import { publicSourceUrl } from "./public-issue-projection.ts";
import { schemaCheckedUtcMicroseconds as micros } from "./exact-utc-observation.ts";

// Match Python _plain: NEL is blank, BOM is not; permitted boundary
// whitespace remains verbatim. The locked Zod bounds already count code points.
const nonblank = /[^\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/u;
const text = (max: number) => z.string().min(1).max(max).refine(value =>
  !/[\ud800-\udfff]/u.test(value) && nonblank.test(value) && !/[\u0000-\u001f]/.test(value));
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const sourceKey = z.string().regex(/^[a-z0-9][a-z0-9:-]{0,119}$/);
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const instant = z.iso.datetime().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/).refine(value => !value.startsWith("0000-"));
const source = z.strictObject({ source_key: sourceKey, source_version_id: uuid, feed_url: publicSourceUrl,
  content_sha256: hash, retrieved_at: instant });
const lead = z.strictObject({ source_key: sourceKey, source_version_id: uuid, source_content_sha256: hash,
  entry_id: text(300), title: text(300), url: publicSourceUrl, locator: z.string().regex(/^feed-entry:([1-9]|[1-4][0-9]|50)$/),
  published_text: text(160).nullable(), updated_text: text(160).nullable(), review_state: z.literal("unverified_discovery") });
const held = z.strictObject({ entry_number: z.number().int().min(1).max(50),
  reason_code: z.enum(["entry_identity_invalid", "entry_identity_duplicate", "entry_title_invalid", "entry_link_invalid_or_ambiguous", "entry_date_text_invalid"]),
  entry_id: text(300).nullable() });
const page = z.strictObject({ source, format: z.enum(["rss20", "atom10"]), entries: z.array(lead).max(50),
  held: z.array(held).max(50), next_url: publicSourceUrl.nullable(),
  parser_identity: z.literal("terrafracta-feed-discovery/v1:feedparser/6.0.14"), coverage: z.literal("single_feed_window") });
const schema = z.strictObject({ schema_version: z.literal(1), kind: z.literal("private_feed_discovery_report"),
  current: page, previous: page.nullable(), source_bytes_changed: z.boolean().nullable(),
  changes: z.array(z.strictObject({ state: z.enum(["first_observed", "reobserved_metadata", "metadata_revised", "held_current_entry", "held_baseline_entry"]),
    current: lead, previous: lead.nullable() })).max(50),
  not_reobserved: z.array(z.strictObject({ previous: lead,
    reason_code: z.enum(["not_in_current_feed_window", "held_in_current_window"]) })).max(50),
  review_state: z.literal("unverified_discovery_comparison") });

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const metadata = (value: z.infer<typeof lead>) => [value.entry_id, value.title, value.url, value.published_text, value.updated_text];
// Equal original bytes, source URL, format and parser fix the complete ordered
// parsed window. Only retrieval/version receipt fields may change on a reread.
const parsedWindow = (value: z.infer<typeof page>) => [
  value.entries.map(entry => [...metadata(entry), entry.locator]), value.held, value.next_url,
];

// Closed supplied assertions, not raw-byte verification, source rights or an
// operational fallback. The Python producer separately binds the raw windows.
export function feedDiscoveryReport(input: unknown) {
  try {
    const report = schema.parse(input), { current, previous } = report;
    for (const window of previous === null ? [current] : [current, previous]) {
      const positions = [...window.entries.map(entry => Number(entry.locator.split(":")[1])), ...window.held.map(entry => entry.entry_number)];
      if (positions.length > 50 || new Set(positions).size !== positions.length || positions.some(value => value > positions.length) ||
          window.held.some(entry => (entry.reason_code === "entry_identity_invalid") !== (entry.entry_id === null)) ||
          new Set(window.entries.map(entry => entry.entry_id)).size !== window.entries.length ||
          window.entries.some(entry => entry.source_key !== window.source.source_key || entry.source_version_id !== window.source.source_version_id || entry.source_content_sha256 !== window.source.content_sha256)) return null;
    }
    if (previous === null ? report.source_bytes_changed !== null :
      current.source.source_key !== previous.source.source_key || current.source.feed_url !== previous.source.feed_url ||
      current.format !== previous.format || micros(current.source.retrieved_at) < micros(previous.source.retrieved_at) ||
      report.source_bytes_changed !== (current.source.content_sha256 !== previous.source.content_sha256) ||
      current.source.source_version_id === previous.source.source_version_id && report.source_bytes_changed) return null;
    if (previous !== null && !report.source_bytes_changed && !equal(parsedWindow(current), parsedWindow(previous))) return null;
    const prior = new Map(previous?.entries.map(entry => [entry.entry_id, entry]) ?? []);
    const uncertain = new Set(current.held.map(entry => entry.entry_id));
    const uncertainPrior = new Set(previous?.held.map(entry => entry.entry_id) ?? []);
    if (report.changes.length !== current.entries.length || report.changes.some((row, index) => {
      const old = prior.get(row.current.entry_id) ?? null;
      const state = uncertain.has(row.current.entry_id) ? "held_current_entry" : uncertainPrior.has(row.current.entry_id) ? "held_baseline_entry"
        : old === null ? "first_observed" : equal(metadata(old), metadata(row.current)) ? "reobserved_metadata" : "metadata_revised";
      return !equal(row.current, current.entries[index]) || !equal(row.previous, old) || row.state !== state;
    })) return null;
    const present = new Set(current.entries.map(entry => entry.entry_id));
    const missing = (previous?.entries ?? []).filter(entry => !present.has(entry.entry_id)).map(entry => ({ previous: entry,
      reason_code: uncertain.has(entry.entry_id) ? "held_in_current_window" : "not_in_current_feed_window" }));
    return equal(missing, report.not_reobserved) ? report : null;
  } catch { return null; }
}
