"use client";

import { useId } from "react";
import { compareFictionalSavedRuns } from "../../src/fictional-saved-run-comparison.ts";
import { FictionalComparison } from "../update-preview/comparison";

const reasons = {
  unavailable: "A saved result could not be checked. Its comparison details are withheld.",
  execution_order: "Choose two different saved runs, with the earlier run executed before the selected run.",
  missing_observation: "At least one run has no checked observation. Missing or held source evidence cannot support this comparison.",
  observation_mismatch: "The checked drafts do not agree on source location, observation or retrieval order. Their difference is withheld.",
};

export function SavedRunComparison({ earlier, later, isCurrent }: { earlier: unknown; later: unknown; isCurrent?: () => boolean }) {
  const heading = useId();
  const checked = compareFictionalSavedRuns(earlier, later);
  if (checked.kind === "held") return <section className="info-band" role="status">
    <h3>Saved-run comparison held</h3><p>{reasons[checked.reason]}</p>
  </section>;
  return <section aria-labelledby={heading}>
    <h3 id={heading}>Two saved fictional runs</h3>
    <div className="desk-grid">{[{ label: "Earlier run", run: checked.earlier }, { label: "Selected later run", run: checked.later }].map(({ label, run }) => {
      return <article key={run.execution.id}><p className="eyebrow">{label}</p>
        <p>Executed <time dateTime={run.execution.executedAt}>{run.execution.executedAt}</time></p>
        <p>{run.report.items.length} checked · {run.report.items.filter(item => item.outcome === "held").length} held · zero published</p>
        <details><summary>Saved execution reference</summary><code>{run.execution.id}</code></details>
      </article>;
    })}</div>
    <p>These execution times identify stored rehearsals. The source retrieval dates below belong to invented fixtures. Selecting runs starts no update and changes no saved record.</p>
    <FictionalComparison key={`${checked.earlier.execution.id}:${checked.later.execution.id}`} baseline={checked.before} candidate={checked.after} isCurrent={isCurrent} />
  </section>;
}
