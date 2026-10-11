import saved from "../fixtures/fictional_private_recovery_snapshot.json";
import { parsePrivateRecoveryTrial } from "./private-recovery-trial.ts";

const labels = {
  before_saving: { title: "Stopped before saving", detail: "No sample pair was stored. The original reading allowance remained reserved." },
  saving_reply_lost: { title: "Saved answers, missing finish", detail: "The preserved sample files matched their database record. An unconfirmed finish remains visible." },
  finish_reply_lost: { title: "Recorded finish, missing reply", detail: "The preserved files and original database finish were confirmed by reading the existing records." },
  completed_sample: { title: "Completed sample inspected", detail: "The completed sample still matched its saved files and original finish." },
} as const;

export function PrivateRecoveryTrialView() {
  const record = parsePrivateRecoveryTrial(saved);
  return (
    <section className="completion-results" aria-labelledby="private-recovery-heading">
      <div className="section-heading"><h2 id="private-recovery-heading">Inspecting a stopped collection</h2><span className="tag tag--caution">Invented data</span></div>
      <p>A missing reply does not start another collection. These checks inspected four saved sample attempts, keeping their original history and pending status.</p>
      <details className="evidence-disclosure"><summary>What the saved records showed</summary>
        <ul className="source-preparation__stages" role="list">
          {record.cases.map((item) => <li key={item.scenario} className="completion-results__card completion-results__card--partial">
            <h3>{labels[item.scenario].title}</h3><p>{labels[item.scenario].detail}</p>
            <p className="tag tag--caution">Remains private and pending</p>
          </li>)}
        </ul>
        <p>Nothing was fetched again, repaired or published. An earlier admission is historical evidence and does not permit a new run.</p>
        <p>Recorded <time dateTime={record.recordedAt}>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" }).format(new Date(record.recordedAt))}</time> Oslo. This is a saved test result, not current service health.</p>
      </details>
    </section>
  );
}
