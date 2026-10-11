"use client";

import { useState } from "react";
import { evaluateSyntheticReadGate } from "./synthetic-read-gate";
import type { SyntheticGateSwitches } from "./synthetic-read-gate";

const gates: Array<{ key: keyof SyntheticGateSwitches; label: string; explanation: string }> = [
  {
    key: "sourceTitleReviewed",
    label: "Source title reviewed",
    explanation: "The displayed source title matches the selected source version.",
  },
  {
    key: "issueTextReviewed",
    label: "Issue text reviewed",
    explanation: "The issue title and summary match the selected publication.",
  },
  {
    key: "periodLabelReviewed",
    label: "Period label reviewed",
    explanation: "The claim's displayed period matches its selected review.",
  },
  {
    key: "claimWordingReviewed",
    label: "Claim wording reviewed",
    explanation: "The claim's type and exact wording match the selected decision.",
  },
  {
    key: "publicReuseAllowed",
    label: "Public source use allowed",
    explanation: "The current source registration permits a public derived display.",
  },
  {
    key: "citationSelected",
    label: "Exact citation selected",
    explanation: "The selected citation set matches the source locations on the claim.",
  },
];

const initial: SyntheticGateSwitches = {
  sourceTitleReviewed: false,
  issueTextReviewed: false,
  periodLabelReviewed: false,
  claimWordingReviewed: false,
  publicReuseAllowed: false,
  citationSelected: false,
};

export function ReadGateRehearsal() {
  const [switches, setSwitches] = useState<SyntheticGateSwitches>(initial);
  const passes = evaluateSyntheticReadGate(switches);
  const missing = gates.filter((gate) => !switches[gate.key]);

  return (
    <section className="read-gate-rehearsal" aria-labelledby="read-gate-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Read gate rehearsal</p>
          <h2 id="read-gate-title">What holds a source-backed page?</h2>
        </div>
        <span className="section-index">SYNTHETIC / UNSAVED</span>
      </div>
      <p className="rehearsal__intro">Turn on the fictional conditions to see whether the existing local read check accepts the sample. No real source, reviewer or right is connected. Refreshing clears these switches.</p>
      <fieldset className="read-gate-rehearsal__choices">
        <legend>Fictional conditions</legend>
        {gates.map((gate) => (
          <label className="read-gate-rehearsal__choice" key={gate.key}>
            <input
              type="checkbox"
              checked={switches[gate.key]}
              onChange={(event) => setSwitches((current) => ({
                ...current, [gate.key]: event.target.checked,
              }))}
            />
            <span><strong>{gate.label}</strong><small>{gate.explanation}</small></span>
          </label>
        ))}
      </fieldset>
      <div className={`read-gate-rehearsal__result ${passes ? "read-gate-rehearsal__result--pass" : ""}`} role="status" aria-live="polite">
        <strong>{passes ? "Fictional read shape passes" : "Fictional page remains held"}</strong>
        <p>{passes
          ? "The local checker can form a bounded sample page. This is not editorial approval or publication."
          : missing.length > 0
            ? `Missing in this scenario: ${missing.map((gate) => gate.label.toLowerCase()).join(", ")}.`
            : "The local checker rejected this sample; inspect the read contract before using it."}</p>
      </div>
    </section>
  );
}
