import type { ReactNode } from "react";

// Recorded project milestone, never a source registry, runtime gate or health
// probe. No source payload, private identity, approval control or writer exists
// in this view. Update the date and descriptions with observed milestones.
const stages = [
  { title: "Source review", state: "Complete for a private attempt", complete: true,
    explanation: "The owner has reviewed the Norwegian and English material. One private attempt is supported, with unresolved public wording held." },
  { title: "Storage safeguards", state: "Preparation in progress", complete: false,
    explanation: "NAS storage is selected and is not ready. Automatic private cleanup is installed and has run on this PC; it does not establish NAS controls. Application access expires at 30 days; expired files are removed while the machine runs or after startup. The NAS account, copy exclusions and cleanup need installation verification." },
  { title: "Collection checks", state: "Passed with invented data", complete: true,
    explanation: "Two sample responses have passed the connected collection and private storage checks using the reviewed code at startup. Invalid answers, interrupted work and missing acknowledgments are held without automatic collection again. Real-source operation is still awaiting its remaining checks." },
  { title: "Private collection", state: "Not started", complete: false,
    explanation: "The first attempt is limited to one metadata response and one data response from SSB table 14059, for 2024 and 2025." },
  { title: "Website publication", state: "Held", complete: false,
    explanation: "Collection does not publish a fact. Public wording and the complete source-to-website path still need their own checks." },
] as const;

export function SourcePreparationView({ children }: { children?: ReactNode }) {
  return (
    <section className="source-preparation" aria-labelledby="source-preparation-heading">
      <div className="section-heading">
        <div><p className="eyebrow">First source / SSB 14059</p><h2 id="source-preparation-heading">From review to a private attempt</h2></div>
        <span className="tag tag--caution">Collection has not started</span>
      </div>
      <p className="source-preparation__record">Recorded <time dateTime="2026-10-04">4 October 2026</time>. This is a project progress record, not a live service check.</p>
      <ol className="source-preparation__stages" role="list" aria-label="Source preparation stages">
        {stages.map((stage, index) => (
          <li key={stage.title} className={`completion-results__card completion-results__card--${stage.complete ? "completed" : "partial"}`}>
            <span className="source-preparation__step" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <h3>{stage.title}</h3>
            <p className={`tag tag--${stage.complete ? "good" : "caution"}`}>{stage.state}</p>
            <p>{stage.explanation}</p>
          </li>
        ))}
      </ol>
      <details className="evidence-disclosure">
        <summary>Information held from public wording</summary>
        <p>Respondent counts and their units, the collection period and the exact upper percentage-band boundary remain unresolved. The private attempt will preserve that uncertainty.</p>
        <p>Source review is a one-time onboarding step. Future routine facts within a separately qualified route can be checked automatically; the owner does not need to sign every item.</p>
      </details>
      {children}
    </section>
  );
}
