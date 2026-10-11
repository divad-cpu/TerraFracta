import saved from "../../fixtures/fictional_authenticated_publication_snapshot.json";
import { parseFictionalAuthenticatedPublication } from "../../src/fictional-authenticated-publication";

const record = parseFictionalAuthenticatedPublication(saved);

export function FictionalAuthenticatedPublicationResult() {
  return (
    <section className="pipeline-results" aria-labelledby="automatic-checks-heading">
      <p className="eyebrow">Saved isolated trials / entirely fictional</p>
      <h2 id="automatic-checks-heading">Automatic checks before a fact is saved</h2>
      <p>A test account completed the connected update using its own limited access. These checks needed no signature on each finding.</p>
      <ol className="pipeline-results__stages">
        <li className="pipeline-results__stage pipeline-results__stage--passed"><span className="pipeline-results__number" aria-hidden="true">1</span><div><h3>Qualified fact saved</h3><p>One invented fact passed the fixed checks and was saved with its source reference.</p></div><span className="pipeline-results__status">Stored</span></li>
        <li className="pipeline-results__stage pipeline-results__stage--held"><span className="pipeline-results__number" aria-hidden="true">2</span><div><h3>Withdrawn source permission respected</h3><p>The finding was held after permission to publish derived information was withdrawn.</p></div><span className="pipeline-results__status">Held</span></li>
        <li className="pipeline-results__stage pipeline-results__stage--held"><span className="pipeline-results__number" aria-hidden="true">3</span><div><h3>Invalid display stopped</h3><p>An inconsistent evidence date stopped the fact from being saved.</p></div><span className="pipeline-results__status">Rolled back</span></li>
      </ol>
      <details><summary>Access expiry and simultaneous attempts</summary><p>Saving was refused when the account’s permission expired during the operation. {record.simultaneousAttempts} simultaneous attempts saved the same fact only {record.resultingActivations} time. Repeating the saved result did not read the source again.</p><p>These tests used local invented source data. They do not enable live publishing or confirm website visibility. Recorded {record.recordedAt.slice(0, 10)}.</p></details>
    </section>
  );
}
