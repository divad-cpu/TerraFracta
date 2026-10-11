import { useId } from "react";
import { fictionalUpdateResultSchema } from "./fictional-update-result.ts";
import { fictionalOutcomeLabel, fictionalReasonLabel } from "./fictional-decision-labels.ts";

// Closed, read-only presenter. Unknown/private fields cannot become a review
// screen; it grants no approval and reads no source, filesystem or credentials.
export function FictionalRunReview({ input, draftNavigation }: {
  input: unknown; draftNavigation?: { draftId: string; originId: string };
}) {
  const heading = useId();
  const checked = fictionalUpdateResultSchema.safeParse(input);
  if (!checked.success) return <section className="info-band" role="status"><h2>Saved rehearsal unavailable</h2><p>This result could not be checked. Its details are withheld.</p></section>;
  const { execution, report } = checked.data;
  const held = report.items.filter((item) => item.outcome === "held").length;
  const unchanged = report.items.filter((item) => item.outcome === "unchanged").length;
  const proposed = report.items.filter((item) => item.outcome === "shadow_only").length;
  return <section className="completion-results" aria-labelledby={heading}>
    <div className="section-heading"><h2 id={heading}>Review the saved rehearsal</h2><span className="tag tag--caution">Invented data</span></div>
    <p>Executed <time dateTime={execution.executedAt}>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" }).format(new Date(execution.executedAt))}</time> Oslo · {report.trigger === "scheduled" ? "weekly rehearsal" : "manual rehearsal"}.</p>
    <div className="desk-grid">
      <article><p className="eyebrow">Run outcome</p><h3>{report.state === "completed" ? "Rehearsal completed" : "Rehearsal needs attention"}</h3><p>{report.items.length} items checked · {proposed} proposed · {held} held · {unchanged} unchanged.</p></article>
      <article><p className="eyebrow">Source coverage</p><h3>{report.coveredSourceKeys.length} of {report.dueSourceKeys.length} expected sources</h3><p>{report.coveredSourceKeys.length < report.dueSourceKeys.length ? "An absent or unverified source leaves this run incomplete." : "The expected fictional source is covered. This is not a live source health check."}</p></article>
    </div>
    <p className="info-band"><strong>Zero published · zero model calls.</strong> These are stored rehearsal decisions. Viewing them does not approve a source or release a claim.</p>
    <ol className="update-report__items">{report.items.map((item) => <li className="update-report__item" key={item.itemKey}
      id={draftNavigation && item.itemKey === report.fictionalCandidate?.itemKey ? draftNavigation.originId : undefined}>
      <div><h3>{fictionalOutcomeLabel[item.outcome] ?? "Further checks required"}</h3><p>{item.reasonCodes.map((code) => fictionalReasonLabel[code] ?? "Additional review is required.").join(" ")}</p><details><summary>Item reference</summary><code>{item.itemKey}</code></details>
        {draftNavigation && item.itemKey === report.fictionalCandidate?.itemKey && <p><a href={`#${draftNavigation.draftId}`}>Inspect this item’s checked draft</a></p>}
      </div>
      <div className="update-report__source">{item.source === null ? <><strong>Source details withheld</strong><span>This source reference did not pass the checks.</span></> : <>
        <strong>{item.source.title}</strong><span>{item.source.publisher}</span><span>Illustrative address: {item.source.url}</span><span>Exact location: <code>{item.source.locator}</code></span>
      </>}{!item.sourceBindingValid && <strong>Source coverage is incomplete</strong>}</div>
    </li>)}</ol>
    {report.items.length === 0 && <p>No items were checked. The expected source remains uncovered.</p>}
    <details><summary>Saved execution reference</summary><code>{execution.id}</code></details>
  </section>;
}
