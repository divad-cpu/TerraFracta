import record from "../../fixtures/fictional_response_snapshot.json";
import { parseFictionalResponseSnapshot } from "../../src/fictional-response-snapshot";

const descriptions = {
  shared_limit: { title: "One shared limit", explanation: "Two requests competed for the same allowance. The second was refused before reading. The first allowance stays reserved." },
  measured_replay: { title: "A repeat reads once", explanation: "The invented stream contained three bytes. Repeating the operation opened no second stream, and unused allowance became available again." },
  crash_takeover: { title: "A crash keeps its allowance", explanation: "The test process exited after saving its dispatch marker. A replacement worker could not resend that request or reclaim its uncertain allowance." },
};

export function FictionalResponseResults() {
  const snapshot = parseFictionalResponseSnapshot(record);
  return (
    <section className="completion-results" aria-labelledby="response-results-heading">
      <div className="section-heading"><h2 id="response-results-heading">Limits checked before reading</h2><span>Saved fictional trials</span></div>
      <p className="completion-results__intro">These three saved tests use an allowance of only 101 bytes to make the limits easy to see. They test simultaneous work, repeated calls and a process crash. No real source was contacted.</p>
      <div className="completion-results__cards">
        {snapshot.cases.map((entry) => <article key={entry.caseKey} className={`completion-results__card${entry.caseKey === "measured_replay" ? " completion-results__card--completed" : ""}`}>
          <p className="eyebrow">{entry.caseKey === "measured_replay" ? "Measured result" : "Allowance retained"}</p>
          <h3>{descriptions[entry.caseKey].title}</h3><p>{descriptions[entry.caseKey].explanation}</p>
          <dl><div><dt>Allowance in use</dt><dd>{entry.chargedBytes} / {entry.byteCap} bytes</dd></div><div><dt>Saved dispatch markers</dt><dd>{entry.dispatches}</dd></div><div><dt>Settled responses</dt><dd>{entry.settlements}</dd></div><div><dt>Worker attempts</dt><dd>{entry.workClaims}</dd></div></dl>
          <meter className="response-results__meter" min={0} max={entry.byteCap} value={entry.chargedBytes} aria-label={`${descriptions[entry.caseKey].title}: allowance in use`}>{entry.chargedBytes} of {entry.byteCap} bytes</meter>
          <details><summary>About this saved test</summary><p>A dispatch marker is saved before a stream can open. It does not prove that a network request happened.</p><p>Reservation saved <time dateTime={entry.savedAt}>{new Intl.DateTimeFormat("en-GB",{ dateStyle:"medium",timeStyle:"medium",timeZone:"Europe/Oslo" }).format(new Date(entry.savedAt))}</time> Oslo.</p></details>
        </article>)}
      </div>
      <p className="completion-results__limit">This read-only view shows selected retained evidence. The test allowance is not an approved live limit. Actual sources, the weekly schedule and publication remain disabled.</p>
    </section>
  );
}
