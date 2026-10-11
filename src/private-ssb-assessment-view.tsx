import saved from "../fixtures/fictional_private_ssb_assessment_snapshot.json";
import { parsePrivateSSBAssessment } from "./private-ssb-assessment.ts";

const meanings = {
  respondent_count_unit: "What the reported response count measures",
  fieldwork_period: "When the survey responses were collected",
  upper_band_boundary: "How the upper percentage band is defined",
} as const;

export function PrivateSSBAssessmentView() {
  const record = parsePrivateSSBAssessment(saved);
  return (
    <section className="completion-results" aria-labelledby="private-assessment-heading">
      <div className="section-heading"><h2 id="private-assessment-heading">From saved responses to a held result</h2><span className="tag tag--caution">Invented data</span></div>
      <p className="completion-results__intro">The recorded trial matched the saved responses and assessed both selected years. Each result stays private and pending while its meaning remains unresolved.</p>
      <ul className="source-preparation__stages" role="list" aria-label="Recorded yearly outcomes">
        {record.candidates.map((candidate) => (
          <li key={candidate.year} className="completion-results__card completion-results__card--partial">
            <h3>Survey year {candidate.year}</h3><p className="tag tag--caution">Held for clarification</p>
            <p>The annual observation is identified. No numerical claim is presented.</p>
          </li>
        ))}
      </ul>
      <div className="info-band"><strong>Meaning still to establish</strong><ul>{record.unresolvedMeanings.map((key) => <li key={key}>{meanings[key]}</li>)}</ul></div>
      <details className="evidence-disclosure"><summary>About this recorded result</summary>
        <p>This demonstrates assessment with invented responses. It does not show an actual SSB collection or an approved public fact. Saving responses does not make them eligible for publication.</p>
        <p>Recorded <time dateTime={record.recordedAt}>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" }).format(new Date(record.recordedAt))}</time> Oslo. The update remains partial and the accepted-data position has not advanced.</p>
      </details>
    </section>
  );
}
