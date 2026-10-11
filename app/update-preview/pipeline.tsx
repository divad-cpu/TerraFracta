"use client";

import { useState } from "react";
import saved from "../../fixtures/fictional_pipeline_snapshot.json";
import { parseFictionalPipelineSnapshot, pipelineStages, type PipelineCase } from "../../src/fictional-pipeline-snapshot";

const record = parseFictionalPipelineSnapshot(saved);
const labels = { stored_fact: "Fact stored", held_finished: "Finding held", missing_decision: "Decision missing" };
const statuses = { passed: "Checked", held: "Held", pending: "Pending", not_needed: "Not required" };

export function FictionalPipelineResults() {
  const [choice, setChoice] = useState<PipelineCase["caseKey"]>("stored_fact");
  const entry = record.cases.find((item) => item.caseKey === choice)!;
  return (
    <section className="pipeline-results" aria-labelledby="pipeline-heading">
      <div className="section-heading"><div><p className="eyebrow">One connected update / entirely fictional</p><h2 id="pipeline-heading">From captured information to a saved result</h2></div><span className="tag tag--caution">Saved isolated trials</span></div>
      <p>Each example used the same update driver, from a bounded local read to a checked database result. No real source was contacted.</p>
      <label className="pipeline-results__selector" htmlFor="pipeline-case">Choose a saved fictional run
        <select id="pipeline-case" value={choice} onChange={(event) => setChoice(event.target.value as PipelineCase["caseKey"])}>
          {record.cases.map((item) => <option key={item.caseKey} value={item.caseKey}>{labels[item.caseKey]}</option>)}
        </select>
      </label>
      <div className="pipeline-results__result" aria-live="polite" aria-atomic="true"><strong>{labels[entry.caseKey]}</strong><span>{entry.runState === "completed" ? "Processing finished. No fact was published." : entry.storedFacts ? "One invented fact is stored. Website visibility is still pending." : "The unresolved decision stays visible. No fact was published."}</span></div>
      <ol className="pipeline-results__stages">
        {pipelineStages(entry).map((stage, index) => <li key={stage.key} className={`pipeline-results__stage pipeline-results__stage--${stage.status}`}>
          <span className="pipeline-results__number" aria-hidden="true">{index + 1}</span><div><h3>{stage.title}</h3><p>{stage.detail}</p></div><span className="pipeline-results__status">{statuses[stage.status]}</span>
        </li>)}
      </ol>
      {entry.storedFacts > 0 && <article className="pipeline-results__fact">
        <p className="eyebrow">Read back from the isolated database / fictional</p><h3>{record.fact.assertion}</h3>
        <p>{record.fact.title} · {record.fact.publisher}</p><p><a href={record.fact.url}>Illustrative source address</a></p>
        <p>Exact location: <code>{record.fact.locator}</code></p><p>Evidence checked {record.fact.lastEvidenceReviewOn}. This is an invented example.</p>
      </article>}
      <details><summary>What these saved results establish</summary><p>The source check, expected finding, decision and processing result were read back after separate database commits. A deliberately inconsistent display was also refused before activation could commit.</p><p>These trials used an owner test adapter. They do not establish an authenticated live runner or confirm what a visitor sees on the four website views.</p></details>
    </section>
  );
}
