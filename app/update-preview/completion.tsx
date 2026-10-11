import record from "../../fixtures/fictional_completion_snapshot.json";
import { parseFictionalCompletionSnapshot } from "../../src/fictional-completion-snapshot";

const snapshot = parseFictionalCompletionSnapshot(record);
const descriptions = {
  stored_fact: { title: "Fact stored, visibility pending", explanation: "One invented fact was saved in the isolated trial. Its database projection was read back; the four website views have not been confirmed." },
  held_finished: { title: "Held finding, run finished", explanation: "The finding was processed and held. That resolves the item without publishing it; the run can finish." },
  missing_decision: { title: "Missing decision, run incomplete", explanation: "The source was checked, but the expected item has no recorded decision. The run preserves that gap and needs attention." },
};

export function FictionalCompletionResults() {
  return (
    <section className="completion-results" aria-labelledby="completion-heading">
      <div className="section-heading"><div><p className="eyebrow">Saved trials / entirely fictional</p><h2 id="completion-heading">When is an update finished?</h2></div><span className="tag tag--caution">Isolated test results</span></div>
      <p className="completion-results__intro">These results were read from three retained database trials. They are separate from the local draft operation above. Nothing here enables real collection or publication.</p>
      <div className="completion-results__ledger"><span><strong>{snapshot.displayedRuns}</strong> selected saved runs</span><span><strong>{snapshot.sourceContentVersions}</strong> invented content version</span><span><strong>{snapshot.freshSourceChecks}</strong> source check receipts</span><span><strong>{snapshot.unchangedSourceChecks}</strong> checks confirmed unchanged content</span></div>
      <div className="completion-results__cards">
        {snapshot.cases.map((entry) => <article key={entry.caseKey} className={`completion-results__card completion-results__card--${entry.runState}`}>
          <p className="eyebrow">{entry.runState === "completed" ? "Processing finished" : "Needs attention"}</p>
          <h3>{descriptions[entry.caseKey].title}</h3><p>{descriptions[entry.caseKey].explanation}</p>
          <dl><div><dt>Sources checked</dt><dd>{entry.coveredSources} / {entry.expectedSources}</dd></div><div><dt>Items decided</dt><dd>{entry.decidedItems} / {entry.expectedItems}</dd></div><div><dt>Held findings</dt><dd>{entry.heldItems}</dd></div><div><dt>Items still unresolved</dt><dd>{entry.pendingItems}</dd></div><div><dt>Facts stored in the trial</dt><dd>{entry.storedFacts}</dd></div><div><dt>Facts confirmed across website views</dt><dd>{entry.visibleFacts}</dd></div></dl>
          <details><summary>Recorded trial stages</summary><p>Processing: {entry.runState}. Storage: {entry.commitState}. Website visibility: {entry.visibilityState.replaceAll("_", " ")}.</p><p>Saved <time dateTime={entry.finishedAt}>{new Intl.DateTimeFormat("en-GB",{ dateStyle:"medium",timeStyle:"medium",timeZone:"Europe/Oslo" }).format(new Date(entry.finishedAt))}</time> Oslo.</p></details>
        </article>)}
      </div>
      <p className="completion-results__limit">A stored fact needs independent checks of the issue page, overview, source panel and search. A visitor cannot grant publication or change a recorded outcome here. The figures show each trial as it was saved.</p>
    </section>
  );
}
