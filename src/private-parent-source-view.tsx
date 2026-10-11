import snapshot from "../fixtures/private_parent_source_preparation_snapshot.json";
import { parsePrivateParentSource } from "./private-parent-source";
import { CurrentParentSourceView } from "./current-parent-source-view";

export function PrivateParentSourceView() {
  const observation = parsePrivateParentSource(snapshot);
  const recorded = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Oslo", dateStyle: "medium", timeStyle: "short" }).format(new Date(observation.recordedAt));
  return (
    <section className="completion-results" aria-labelledby="parent-source-heading">
      <header className="section-heading"><div><span className="eyebrow">Saved preparation</span><h2 id="parent-source-heading">Preparing the collection process for review</h2></div></header>
      <p>The code that coordinates private collection and records each admitted attempt has been preserved with its database interface. This is a source review target.</p>
      <p className="source-preparation__record">Recorded <time dateTime={observation.recordedAt}>{recorded} (Oslo)</time>. This saved preparation is not a live service check.</p>
      <ul className="source-preparation__stages" role="list" aria-label="Saved source preparation boundaries">
        <li className="completion-results__card completion-results__card--partial"><span className="metric-label">Source preparation</span><h3>Bytes verified</h3><p>{observation.sourceFiles} source files and the fixed private database interface are included. The collection code was inspected without running it.</p></li>
        <li className="completion-results__card completion-results__card--partial"><span className="metric-label">Operational setup</span><h3>Still to be selected</h3><p>The actual private account, storage and attempt journal, logging and withdrawal arrangements need a connected review.</p></li>
        <li className="completion-results__card completion-results__card--partial"><span className="metric-label">Collection</span><h3>Held</h3><p>Copy coverage and the selected operational context remain unresolved. This saved preparation grants no permission to collect or publish.</p></li>
      </ul>
      <details className="evidence-disclosure"><summary>What this preparation establishes</summary><ul><li>The saved source bytes match the recorded review target.</li><li>No candidate module was imported or worker executed during preparation.</li><li>The complete runtime and selected deployment have not been accepted.</li><li>The saved files are on this machine; an external backup has not been established.</li></ul></details>
      <CurrentParentSourceView />
    </section>
  );
}
