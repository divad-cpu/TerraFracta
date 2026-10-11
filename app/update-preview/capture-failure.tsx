import saved from "../../fixtures/fictional_capture_failure_snapshot.json";
import { parseFictionalCaptureFailure } from "../../src/fictional-capture-failure";

const record = parseFictionalCaptureFailure(saved);

export function FictionalCaptureFailureResult() {
  return (
    <section className="pipeline-results pipeline-results--failure" aria-labelledby="capture-failure-heading">
      <p className="eyebrow">Saved isolated trial / entirely fictional</p>
      <h2 id="capture-failure-heading">When a source cannot be read</h2>
      <p>The update saves an incomplete result. Missing information stays visible, and no fact is published.</p>
      <ol className="pipeline-results__stages">
        <li className="pipeline-results__stage pipeline-results__stage--held"><span className="pipeline-results__number" aria-hidden="true">1</span><div><h3>Required source unavailable</h3><p>The local fixture could not be opened. No source version or finding was invented.</p></div><span className="pipeline-results__status">Failed read</span></li>
        <li className="pipeline-results__stage pipeline-results__stage--not_needed"><span className="pipeline-results__number" aria-hidden="true">2</span><div><h3>Dependent source postponed</h3><p>It depends on the first source. It was neither requested nor given a new reading allowance.</p></div><span className="pipeline-results__status">Deferred</span></li>
        <li className="pipeline-results__stage pipeline-results__stage--pending"><span className="pipeline-results__number" aria-hidden="true">3</span><div><h3>Incomplete result saved</h3><p>{record.requiredSources} required sources remain missing. Their separate checks and the processing result were saved.</p></div><span className="pipeline-results__status">Incomplete</span></li>
      </ol>
      <details><summary>What the saved failure establishes</summary><p>The full reading allowance stays charged because the failed read cannot prove a complete response measurement. The charge is {record.retainedChargeBytes.toLocaleString("en-GB")} bytes; it is not a measured download size.</p><p>This owner-only trial contacted no real source, stored no source body and activated no fact. Cancellation, an expired worker or an unconfirmed settlement still requires separate recovery.</p></details>
    </section>
  );
}
