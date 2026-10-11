"use client";

import { useState } from "react";

type PreviewState = "pending" | "held";

export function ReviewRehearsal() {
  const [state, setState] = useState<PreviewState>("pending");
  const [reason, setReason] = useState("");

  function holdCandidate() {
    if (!reason.trim()) return;
    setState("held");
  }

  function reset() {
    setState("pending");
    setReason("");
  }

  return (
    <section className="rehearsal" aria-labelledby="rehearsal-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Decision rehearsal</p>
          <h2 id="rehearsal-title">Inspect a proposed change</h2>
        </div>
        <span className="section-index">SYNTHETIC / UNSAVED</span>
      </div>
      <p className="rehearsal__intro">This local exercise shows the comparison and hold path. It contains no source evidence, does not save a decision, and has no approval or publication action.</p>
      <div className="rehearsal__comparison">
        <article>
          <p className="eyebrow">Current sample wording</p>
          <h3>Housing costs affect household budgets.</h3>
          <p>Generic demonstration text, with no real claim or evidence record.</p>
        </article>
        <article>
          <p className="eyebrow">Proposed sample wording</p>
          <h3>Housing costs have increased for every household.</h3>
          <p>This wording asserts a universal trend and would need a defined population, periods and supporting evidence.</p>
        </article>
      </div>
      <div className="rehearsal__evidence">
        <strong>Evidence attached: none</strong>
        <p>No source version, locator, date, translation review or conflicting evidence has been supplied. The candidate cannot be treated as an eligible public change.</p>
      </div>
      <div className="rehearsal__decision">
        <label htmlFor="hold-reason">Why hold this sample candidate?</label>
        <textarea
          id="hold-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value.slice(0, 500))}
          placeholder="For example: no source supports the scope of the proposed statement"
          maxLength={500}
          rows={3}
          disabled={state === "held"}
        />
        <div className="rehearsal__actions">
          {state === "pending" ? (
            <button type="button" onClick={holdCandidate} disabled={!reason.trim()}>Mark held in this preview</button>
          ) : (
            <button type="button" onClick={reset}>Reset exercise</button>
          )}
          <span role="status" aria-live="polite">
            {state === "held" ? "Held in this browser only. Nothing was saved." : "Pending in this browser only."}
          </span>
        </div>
      </div>
    </section>
  );
}
