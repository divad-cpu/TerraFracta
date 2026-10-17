import { feedDiscoveryReport } from "./feed-discovery-report.ts";

const labels = { first_observed: "First observed in these supplied windows", reobserved_metadata: "Same feed metadata reobserved",
  metadata_revised: "Feed metadata revised", held_current_entry: "Held: ambiguous current entry", held_baseline_entry: "Held: ambiguous earlier entry" };
const date = (value: string) => <time dateTime={value}><bdi>{value}</bdi></time>;

export function FeedDiscoveryView({ input }: { input: unknown }) {
  const report = feedDiscoveryReport(input);
  if (report === null) return <section><h2>Discovery report unavailable</h2><p>No partial leads, unchanged conclusion or withdrawal inference is displayed.</p></section>;
  const windows = report.previous === null ? [report.current] : [report.current, report.previous];
  return <section aria-labelledby="discovery-heading"><h2 id="discovery-heading">Supplied unverified discovery report</h2>
    <p>Feed metadata supplies document leads, not verified facts or evidence of implementation. First observed does not mean newly published. Original documents have not been fetched by this view.</p>
    <p>Source bytes: {report.source_bytes_changed === null ? "No earlier window supplied" : report.source_bytes_changed ? "Changed between supplied windows" : "Unchanged between supplied windows"}. Byte change is separate from document or metadata change.</p>
    {windows.map((window, index) => <details key={index}><summary>{index === 0 ? "Current supplied window" : "Earlier supplied window"}: {date(window.source.retrieved_at)}</summary>
      <dl><dt>Source identity</dt><dd><code>{window.source.source_key}</code></dd><dt>Feed address (not opened)</dt><dd><bdi>{window.source.feed_url}</bdi></dd>
        <dt>Exact supplied version</dt><dd><code>{window.source.source_version_id}</code></dd><dt>Supplied source-byte hash</dt><dd><code>{window.source.content_sha256}</code></dd>
        <dt>Single-window coverage</dt><dd>{window.entries.length} candidate leads; {window.held.length} held entries. {window.next_url === null ? "No next-page link supplied; historical coverage remains unknown." : <>Another page is advertised but has not been read: <bdi>{window.next_url}</bdi>.</>}</dd></dl>
      {window.held.length > 0 && <ul>{window.held.map(entry => <li key={entry.entry_number}>Held feed entry {entry.entry_number}: <code>{entry.reason_code}</code>. Identity: <bdi>{entry.entry_id ?? "Not safely available"}</bdi>.</li>)}</ul>}
    </details>)}
    <h3>Current candidate leads</h3>
    {report.changes.length === 0 ? <p>No candidate leads in this supplied window. This is not evidence of no new documents or complete collection.</p> : <ol>{report.changes.map((row, index) => <li key={row.current.entry_id}>
      <h4><bdi>{row.current.title}</bdi></h4><p>{labels[row.state]}. Unverified discovery only.</p>
      <details id={`discovery-lead-${index + 1}`}><summary>Inspect current and earlier metadata</summary>
        {[row.current, row.previous].map((entry, vintage) => entry === null ? <p key={vintage}>No earlier candidate with this identity supplied.</p> : <dl key={vintage}>
          <dt>{vintage === 0 ? "Current title" : "Earlier title"}</dt><dd><bdi>{entry.title}</bdi></dd><dt>Entry identity / locator</dt><dd><code>{entry.entry_id}</code> / <code>{entry.locator}</code></dd>
          <dt>Version / hash</dt><dd><code>{entry.source_version_id}</code> / <code>{entry.source_content_sha256}</code></dd>
          <dt>Document address (not opened)</dt><dd><bdi>{entry.url}</bdi></dd>
          <dt>Feed publication date text (unparsed)</dt><dd><bdi>{entry.published_text ?? "Not supplied"}</bdi></dd>
          <dt>Feed modification date text (unparsed)</dt><dd><bdi>{entry.updated_text ?? "Not supplied"}</bdi></dd></dl>)}
      </details></li>)}</ol>}
    <h3>Earlier leads not reobserved as current candidates</h3>
    {report.not_reobserved.length === 0 ? <p>No such leads in this supplied comparison. This does not establish complete historical coverage.</p> : <ul>{report.not_reobserved.map(row => <li key={row.previous.entry_id}>
      <bdi>{row.previous.title}</bdi> — <code>{row.previous.entry_id}</code>, earlier <code>{row.previous.locator}</code>.
      {row.reason_code === "held_in_current_window" ? " Its current entry is held; no absence conclusion is possible." : " Not in the current feed window; this does not establish withdrawal or deletion."}
    </li>)}</ul>}
    <p>No source approval, retention or reuse permission, model dispatch, factual support, checkpoint, publication or public-content change follows from this report. Supplied metadata and dates remain untrusted; retained raw bytes and their provenance require separate verification.</p>
  </section>;
}
