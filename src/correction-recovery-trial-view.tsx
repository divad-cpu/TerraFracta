import saved from "../fixtures/fictional_correction_recovery_snapshot.json";
import { parseCorrectionRecoveryTrial } from "./correction-recovery-trial.ts";

export function CorrectionRecoveryTrialView() {
  const record = parseCorrectionRecoveryTrial(saved);
  return <section className="completion-results" aria-labelledby="correction-recovery-heading">
    <div className="section-heading"><h2 id="correction-recovery-heading">Finding a previous review receipt</h2><span className="tag tag--caution">Saved invented trial</span></div>
    <p>The sample reviewer found a committed closure after its response was left unread. Looking up an earlier review step kept the report closed.</p>
    <ul className="source-preparation__stages" aria-label="Saved receipt lookup outcomes">
      <li className="completion-results__card completion-results__card--partial"><h3>Previous steps found</h3><p>Two historical receipts found. Current report: closed.</p></li>
      <li className="completion-results__card completion-results__card--partial"><h3>Unsent step absent</h3><p>No receipt found. The new report stayed unchanged.</p></li>
      <li className="completion-results__card completion-results__card--partial"><h3>Separate account</h3><p>The other account received no private event receipt.</p></li>
    </ul>
    <p>These lookups changed no report or displayed fact. An absent receipt does not authorize a new attempt.</p>
    <details className="evidence-disclosure"><summary>About this saved lookup</summary>
      <p>Recorded <time dateTime={record.recordedAt}>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" }).format(new Date(record.recordedAt))}</time> Oslo. This dated result is not live status.</p>
      <p>The trial used invented reports with writing disabled before lookup. Real reviewer access and retention rules remain to be selected.</p>
    </details>
  </section>;
}
