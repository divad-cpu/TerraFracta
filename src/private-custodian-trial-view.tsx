import saved from "../fixtures/fictional_private_custodian_snapshot.json";
import { parsePrivateCustodianTrial } from "./private-custodian-trial.ts";

const scenarios = {
  metadata_dispatch_receipt_lost: { title: "Confirmation lost before reading", explanation: "The attempt stopped before the sample answers were read. The reading allowance remained recorded." },
  store_receipt_lost: { title: "Saving completed, confirmation lost", explanation: "The original sample answers and their database record were preserved. The result stayed held for recovery." },
  closeout_receipt_lost: { title: "Database finished, worker confirmation lost", explanation: "The recorded finish and saved answers were preserved. A missing worker confirmation was not reported as success." },
} as const;

export function PrivateCustodianTrialView() {
  const record = parsePrivateCustodianTrial(saved);
  return (
    <section className="completion-results" aria-labelledby="private-custodian-heading">
      <div className="section-heading"><h2 id="private-custodian-heading">The connected private collection path</h2><span className="tag tag--caution">Invented data</span></div>
      <p className="completion-results__intro">The complete trial confirmed the permitted attempt before reading, matched the saved sample answers to their database record, and ended its work. Both selected years remain pending.</p>
      <div className="info-band"><strong>Checked without publishing</strong><p>One pair of sample answers was saved for {record.pendingYears.join(" and ")}. No real source was contacted and no public fact was approved.</p></div>
      <ul className="source-preparation__stages" role="list" aria-label="Recorded interruption checks">
        {record.faults.map((item) => (
          <li key={item.scenario} className="completion-results__card completion-results__card--partial">
            <h3>{scenarios[item.scenario].title}</h3><p className="tag tag--caution">Result held</p>
            <p>{scenarios[item.scenario].explanation}</p>
            <p>No automatic attempt to read again.</p>
          </li>
        ))}
      </ul>
      <details className="evidence-disclosure"><summary>About these connected checks</summary>
        <p>The complete trial and three interruption cases used invented answers in separate local test databases. They demonstrate the connection and preserved outcomes; they do not establish actual SSB access or current service health.</p>
        <p>Recorded <time dateTime={record.recordedAt}>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" }).format(new Date(record.recordedAt))}</time> Oslo. Independent review and the remaining operational checks are still needed before the real private attempt.</p>
      </details>
    </section>
  );
}
