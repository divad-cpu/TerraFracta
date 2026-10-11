import saved from "../fixtures/fictional_correction_review_snapshot.json";
import { parseCorrectionReviewTrial } from "./correction-review-trial.ts";

export function CorrectionReviewTrialView() {
  const record = parseCorrectionReviewTrial(saved);
  return <section className="completion-results" aria-labelledby="correction-review-heading">
    <div className="section-heading"><h2 id="correction-review-heading">Correction review rehearsal</h2><span className="tag tag--caution">Separate invented run</span></div>
    <p>A separate sample run kept four reports private. One was closed, one is under review and two await review. Repeated requests and review steps did not create duplicates.</p>
    <ul className="source-preparation__stages" aria-label="Saved private review states">
      {([{ key: "new", title: "Awaiting review" }, { key: "in_review", title: "Under review" }, { key: "closed", title: "Review closed" }] as const).map(item =>
        <li key={item.key} className="completion-results__card completion-results__card--partial"><h3>{item.title}</h3><p>{record.states[item.key]} invented {record.states[item.key] === 1 ? "report" : "reports"}</p></li>)}
    </ul>
    <p>Closing a report records a private review outcome. It does not change displayed facts or approve a new publication. Earlier review steps remain in the history.</p>
    <details className="evidence-disclosure"><summary>About this saved review</summary>
      <p>Recorded <time dateTime={record.recordedAt}>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" }).format(new Date(record.recordedAt))}</time> Oslo. This is a dated test result, not a live queue.</p>
      <p>The sample has no reader contact details and sent no notifications. Real submission and review still require privacy, retention, access and abuse controls.</p>
    </details>
  </section>;
}
