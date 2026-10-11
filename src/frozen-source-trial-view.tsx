import saved from "../fixtures/fictional_frozen_source_capture_snapshot.json";
import { parseFictionalFrozenSource } from "./fictional-frozen-source.ts";

const descriptions = {
  database_rejected_after_raw: { title: "Storage refused", explanation: "The sample files remain available for recovery. The database contains no saved pair." },
  raw_store_reply_lost: { title: "Saving succeeded, reply lost", explanation: "One pair remains saved. The missing reply holds the outcome for reconciliation, without collecting again." },
  raw_binding_read_before_commit: { title: "Confirmation arrived too early", explanation: "The database operation rolled back. The sample files and the failed attempt remain available for recovery." },
} as const;

export function FrozenSourceTrialView() {
  const record = parseFictionalFrozenSource(saved);
  return (
    <section className="completion-results" aria-labelledby="checked-collection-heading">
      <div className="section-heading"><h2 id="checked-collection-heading">Checked collection and private saving</h2><span>Saved sample trials</span></div>
      <p className="completion-results__intro">The checked collection code handled two invented replies and saved one private pair. Its source versions and saved files matched the database confirmation.</p>
      <p className="tag tag--caution">Awaiting source assessment</p>
      <p>Successful saving does not make a fact ready for the website. No real source was contacted in these trials.</p>
      <div className="completion-results__cards">
        {record.faults.map((entry) => (
          <article key={entry.scenario} className="completion-results__card completion-results__card--partial">
            <p className="eyebrow">Recovery checked</p><h3>{descriptions[entry.scenario].title}</h3>
            <p>{descriptions[entry.scenario].explanation}</p>
            <p className="tag tag--caution">Outcome held</p>
          </article>
        ))}
      </div>
      <details className="evidence-disclosure">
        <summary>About these saved checks</summary>
        <p>The code used at startup matched the admitted request. A copy whose code differed from the checked version was refused before the worker could start. None of these failures started a second collection or erased the original attempt.</p>
        <p>Recorded <time dateTime={record.recordedAt}>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" }).format(new Date(record.recordedAt))}</time> Oslo. These are local development observations; website propagation remains unverified.</p>
      </details>
    </section>
  );
}
