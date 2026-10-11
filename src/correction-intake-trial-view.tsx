import Link from "next/link";
import saved from "../fixtures/fictional_correction_intake_snapshot.json";
import { parseCorrectionIntakeTrial } from "./correction-intake-trial.ts";

export function CorrectionIntakeTrialView() {
  const record = parseCorrectionIntakeTrial(saved);
  return (
    <section className="completion-results" aria-labelledby="correction-intake-heading">
      <div className="section-heading"><h2 id="correction-intake-heading">Reader correction rehearsal</h2><span className="tag tag--caution">Invented reports</span></div>
      <p>Four sample reports were saved privately against the edition they referred to. They await review and have not changed public content. This example contains no reader contact details.</p>
      <ul className="source-preparation__stages" aria-label="Recorded correction editions">
        {record.editions.map(edition => <li key={edition.revision} className="completion-results__card completion-results__card--partial">
          <h3>{edition.revision === 1 ? "First edition" : "Correction edition"}</h3>
          <p>Revision {edition.revision}: {edition.privateReports} invented reports, one about the page and one about a displayed statement.</p>
          <p className="tag tag--caution">Awaiting review</p>
        </li>)}
      </ul>
      <p>The trial refused old editions, statements outside the displayed edition and sources whose display rights had been withdrawn. Reports could not set their own review state or read the private queue.</p>
      <p><Link className="text-link" href="/connected-preview/issue">Try an unsent draft on the connected sample issue →</Link></p>
      <details className="evidence-disclosure"><summary>About this saved rehearsal</summary>
        <p>Recorded <time dateTime={record.recordedAt}>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" }).format(new Date(record.recordedAt))}</time> Oslo. This dated test used invented reports in an isolated local database. It does not describe a live queue or current source rights.</p>
        <p>Real submission, privacy retention, abuse handling and an authenticated review workflow still need implementation and approval.</p>
      </details>
    </section>
  );
}
