import { completePreparationReading } from "./complete-preparation-reading.ts";
import { EvaluationPreparationReadingView } from "./evaluation-preparation-reading-view.tsx";

export function CompletePreparationReadingView({ bundleJson, milestoneJson, context, prefix }: {
  bundleJson: unknown; milestoneJson: unknown; context: unknown; prefix: string;
}) {
  const reading = completePreparationReading(bundleJson, milestoneJson, context);
  if (!reading || typeof prefix !== "string" || !/^[A-Za-z0-9_.:-]{1,100}$/.test(prefix))
    return <p>Preparation overview unavailable. No partial preparation is shown.</p>;
  const plans = reading.milestones;
  const referenceId = (statement: number, reference: number) => `${prefix}-plan-reference-${statement}-${reference}`;
  return <section aria-label="Preparations with planned milestones"><h3>Read preparations with planned milestones</h3>
    <p>These separately copied preparations remain unverified. Exact format and shared comparison do not establish factual support, rights, review, causal effects or publication approval. Entries are not matched across measures or institutions.</p>
    <nav aria-label="Preparation overview sections"><a href={`#${prefix}-seven`}>Problem, response and evaluation preparation</a>{" · "}<a href={`#${prefix}-plans`}>Documented plan preparation</a></nav>
    <section id={`${prefix}-seven`} tabIndex={-1}><h4>Problem, response and evaluation preparation</h4>
      {reading.bundle === null ? <p>No seven-part bundle copy supplied. This is not a finding that evidence or action is absent.</p>
        : <EvaluationPreparationReadingView bundle={reading.bundle} context={reading.context} prefix={`${prefix}-seven`} />}
      <p><a href="#proposal-evaluation-bundle">Open the existing evaluation bundle (expand)</a>. Reopen exact copies there explicitly before editing.</p>
    </section>
    <section id={`${prefix}-plans`} tabIndex={-1}><h4>Separate documented plan preparation</h4>
      <p>Worksheet order is not chronology. Target time and source reporting time remain distinct. A target does not establish completion, delay, failure or present-government responsibility. Unknown dates and limitations remain unknown.</p>
      <p><a href="#proposal-planned-milestone-preparation">Open the planned-milestone worksheet (expand)</a>. Reopen its exact separate copy explicitly before editing.</p>
      {plans.status === "not_supplied" ? <p>No milestone copy supplied. This does not establish that no plans exist.</p>
        : plans.status === "empty" ? <p>The supplied milestone copy has no entries. This is not evidence that no plans exist.</p>
        : <ol>{plans.entries.map((entry, index) => <li key={index}><p><a href={entry.statement.href}>Proposed statement {entry.statement.number} · {entry.statement.label} · <bdi>{entry.statement.period}</bdi></a></p>
          <dl>{entry.fields.map(field => <div key={field.key} id={`${prefix}-plan-${index + 1}-${field.key}`} tabIndex={-1}><dt>{field.label}</dt><dd>{field.value === null ? <p>Unknown — no value or references supplied</p> : <>
            <p><bdi>{field.value}</bdi>{field.precision !== null && <> · Source precision: {field.precision}</>}</p>
            <ul>{field.references.map(key => { const ref = plans.references.find(ref => ref.key === key)!; return <li key={key}><a href={`#${referenceId(ref.statementNumber, ref.referenceNumber)}`}>Proposed statement {ref.statementNumber} · reference {ref.referenceNumber}</a></li>; })}</ul>
          </>}</dd></div>)}</dl></li>)}</ol>}
      <h5>Plan reference occurrences</h5><p>These original captured occurrences are not independent corroboration. Their original relations concern the captured statement, not support for the new preparation wording.</p>
      {plans.references.length === 0 ? <p>No field-specific plan reference choices supplied.</p> : <ul>{plans.references.map(ref => <li key={ref.key} id={referenceId(ref.statementNumber, ref.referenceNumber)} tabIndex={-1}>
        <p>Proposed statement {ref.statementNumber} · reference {ref.referenceNumber}: <bdi>{ref.title}</bdi> · <bdi>{ref.locator}</bdi></p><p>Original relation: {ref.originalRelation}.</p>
        <ul>{ref.selections.map(use => <li key={`${use.entryNumber}-${use.field}`}><a href={`#${prefix}-plan-${use.entryNumber}-${use.field}`}>Milestone {use.entryNumber} · {use.label}</a></li>)}</ul><a href={ref.originalHref}>Inspect original captured reference</a>
      </li>)}</ul>}
    </section>
  </section>;
}
