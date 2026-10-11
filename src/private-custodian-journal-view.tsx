import saved from "../fixtures/fictional_private_custodian_journal.json";
import nativeSaved from "../fixtures/fictional_journaled_native_integration.json";
import { parsePrivateCustodianJournal, parseJournaledNativeIntegration } from "./private-custodian-journal.ts";

const descriptions = {
  missing_finish: { title: "Finish missing", text: "The start was saved, but a finish was never recorded. The outcome remains unknown." },
  failed_before_admission: { title: "Stopped before confirmation", text: "The attempt stopped before confirmation. Its local process cleanup was recorded." },
  interrupted_after_admission: { title: "Interrupted after confirmation", text: "An invented confirmation was saved before the interruption. The held outcome was preserved." },
  cleanup_unknown: { title: "Process ending remains unconfirmed", text: "The ending could not be confirmed. The saved uncertainty prevents this journal from being reused for a new attempt." },
} as const;

const nativeDescriptions = {
  retained_nominal: { title: "Saved for review", text: "The response pair and processing finish were found after restart. The figures remain private and pending review." },
  store_receipt_lost: { title: "Save reply lost", text: "The response pair was saved, but a processing finish was absent. The failed result stayed held." },
  journal_finish_receipt_lost: { title: "Finish reply lost", text: "The saved pair and processing finish were found. The missing reply still prevented the original caller from accepting a result." },
  owned_cancellation: { title: "Interrupted before reading", text: "The attempt stopped before either response was read. No response pair or processing finish was found." },
} as const;

export function PrivateCustodianJournalView() {
  const record = parsePrivateCustodianJournal(saved);
  const nativeRecord = parseJournaledNativeIntegration(nativeSaved);
  return (
    <>
    <section className="completion-results" aria-labelledby="journaled-native-heading">
      <div className="section-heading"><h2 id="journaled-native-heading">Checking saved results after restart</h2><span className="tag tag--caution">Saved invented trials</span></div>
      <p className="completion-results__intro">These trials used invented responses with actual private storage. A new process reopened the saved journal and checked the database outcome. No new attempt or publication followed.</p>
      <ul className="source-preparation__stages" aria-label="Saved integration outcomes">
        {nativeRecord.entries.map((item) => (
          <li key={item.scenario} className="completion-results__card completion-results__card--partial">
            <h3>{nativeDescriptions[item.scenario].title}</h3>
            <p className="tag tag--caution">{item.returnedResultAccepted ? "Pending private review" : "Result withheld"}</p>
            <p>{nativeDescriptions[item.scenario].text}</p>
          </li>
        ))}
      </ul>
      <details className="evidence-disclosure"><summary>About these saved integration trials</summary>
        <p>All four local process endings were confirmed and the temporary database accounts stayed closed during readback. This is a dated observation, not live status or permission for collection.</p>
        <p>The lifetime guard was requested for the local database helper. A local process ending does not prove remote rollback; the saved database outcome was checked separately. The original source transport was never used.</p>
        <p>Recorded <time dateTime={nativeRecord.recordedAt}>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" }).format(new Date(nativeRecord.recordedAt))}</time> Oslo.</p>
      </details>
    </section>
    <section className="completion-results" aria-labelledby="private-journal-heading">
      <div className="section-heading"><h2 id="private-journal-heading">Preserving the outcome after an interruption</h2><span className="tag tag--caution">Saved invented examples</span></div>
      <p className="completion-results__intro">A saved start and finish make uncertainty visible after an interruption. Earlier records remain available for inspection, with no automatic new attempt.</p>
      <ul className="source-preparation__stages" aria-label="Saved journal examples">
        {record.entries.map((item) => (
          <li key={item.scenario} className="completion-results__card completion-results__card--partial">
            <h3>{descriptions[item.scenario].title}</h3>
            <p className="tag tag--caution">{item.state === "outcome_not_recorded" ? "Outcome unknown" : item.state === "local_cleanup_unconfirmed" ? "Needs inspection" : "Result held"}</p>
            <p>{descriptions[item.scenario].text}</p>
          </li>
        ))}
      </ul>
      <details className="evidence-disclosure"><summary>About these saved journal examples</summary>
        <p>These examples saved and reopened private files using invented confirmation records. No database query or source request was made. The unconfirmed process state was injected for the test.</p>
        <p>A confirmed local process ending does not establish whether a remote database write completed. These are historical examples; current service health requires a separate observation.</p>
        <p>Recorded <time dateTime={record.recordedAt}>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" }).format(new Date(record.recordedAt))}</time> Oslo.</p>
      </details>
    </section>
    </>
  );
}
