import { preparationPacketReading, type PreparationReadingReference } from "./preparation-reading.ts";
import { preparationPacketLabels, preparationPacketTargets, type PreparationPart } from "./preparation-packet.ts";

const notes = {
  scope: "Scope wording is preparation, not an accepted problem selection or verified population finding.",
  responsibility: "Institution, level, role and period remain separate. A missing term period does not assign earlier work to a current government.",
  policyEvents: "Announcement, proposal, adoption and entry into force remain distinct events. Worksheet order is not chronology or proof that an event occurred.",
  funding: "Amounts retain exact spelling. Stage, currency, scale, period, price basis and revision remain separate; no total, conversion or expenditure conclusion is calculated.",
  indicators: "Unknown observations are not zero. Matching labels do not establish series identity or comparability; no trend or causal effect is calculated.",
  delivery: "A stage does not supply missing coverage or dates. Adoption or funding does not prove delivery, and local coverage is not national coverage.",
};
const referenceId = (prefix: string, reference: PreparationReadingReference) => `${prefix}-reference-${reference.statementNumber}-${reference.referenceNumber}`;
const fieldId = (prefix: string, part: PreparationPart, entryNumber: number, field: string) => `${prefix}-${part}-${entryNumber}-${field}`;

// Read-only display under the existing private packet gate. No hook state,
// editable control, transport, storage or publication operation is introduced.
export function PreparationReadingView({ packet, context, prefix }: { packet: unknown; context: unknown; prefix: string }) {
  const reading = preparationPacketReading(packet, context);
  if (!reading) return <p>Private preparation reading unavailable. No partial prepared dossier is shown.</p>;
  const references = new Map(reading.references.map(reference => [reference.key, reference]));
  return <details><summary>Read prepared dossier together</summary>
    <h4>Private preparation reading</h4>
    <p>All wording below is unreviewed preparation, even when it claims to describe a source. Format and binding checks establish no factual support, source rights, independent review or publication approval.</p>
    <p>Sections keep their own dimensions and worksheet order. Entries are not matched across measures or institutions, and observations do not establish evaluated effects.</p>
    <nav aria-label="Private prepared dossier sections"><ul>{reading.sections.map(section => <li key={section.part}>
      <a href={`#${prefix}-${section.part}`}>{section.label}</a></li>)}<li><a href={`#${prefix}-references`}>Recorded reference choices</a></li></ul></nav>
    {reading.sections.map(section => <section key={section.part} id={`${prefix}-${section.part}`} tabIndex={-1}>
      <h5>{section.label}</h5><p>{notes[section.part]}</p>
      <p><a href={`#${preparationPacketTargets[section.part]}`}>Open {section.label.toLowerCase()} worksheet (expand)</a>. Reopen this part's exact copied preparation there explicitly before editing.</p>
      {section.status === "not_supplied" ? <p>No copy supplied for this worksheet. This is not a finding about available evidence or government action.</p>
        : section.status === "empty" ? <p>Supplied copy contains no entries. This does not establish absence of action, funding, delivery or observations.</p>
        : <ol>{section.entries.map((entry, index) => <li key={index}>
          {entry.statement && <p><a href={entry.statement.href}>Proposed statement {entry.statement.number} · {entry.statement.label} · <bdi>{entry.statement.period}</bdi></a></p>}
          <dl>{entry.fields.map(field => <div key={field.key} id={fieldId(prefix, section.part, index + 1, field.key)} tabIndex={-1}><dt>{field.label}</dt><dd>
            {field.value === null ? <p>Not supplied in this preparation</p> : <><p><bdi>{field.value}</bdi></p>
              <ul>{field.references.map(key => { const reference = references.get(key)!; return <li key={key}>
                <a href={`#${referenceId(prefix, reference)}`}>Proposed statement {reference.statementNumber} · reference {reference.referenceNumber}</a></li>; })}</ul></>}
          </dd></div>)}</dl>
        </li>)}</ol>}
    </section>)}
    <section id={`${prefix}-references`} tabIndex={-1}><h5>Recorded reference choices</h5>
      <p>These are exact occurrences in the captured comparison, not a count of independent sources. Different occurrences may reuse the same original source. Sharing an occurrence across fields is not independent confirmation. Its original relation concerns the proposed statement, not the new preparation wording.</p>
      {reading.references.length === 0 ? <p>No field-specific reference choices were supplied in these copies. This does not describe which sources exist.</p>
        : <ul>{reading.references.map(reference => <li key={reference.key} id={referenceId(prefix, reference)} tabIndex={-1}>
        <p>Proposed statement {reference.statementNumber} · reference {reference.referenceNumber}: <bdi>{reference.title}</bdi> · <bdi>{reference.locator}</bdi></p>
        <p>Original relation to the proposed statement: {reference.originalRelation}.</p>
        <p>Selected for these preparation fields:</p><ul>{reference.selections.map(selection => <li key={`${selection.part}-${selection.entryNumber}-${selection.field}`}>
          <a href={`#${fieldId(prefix, selection.part, selection.entryNumber, selection.field)}`}>{preparationPacketLabels[selection.part]} · entry {selection.entryNumber} · {selection.label}</a>
        </li>)}</ul>
        <a href={reference.originalHref}>Inspect original captured reference</a>
      </li>)}</ul>}
    </section>
    <p>A missing copy, an empty entry list, a blank field and a source-stated missing-observation reason are different states. Blank preparation fields are not proof of missing evidence or inaction. Inspect the original source before review; the usual source, privacy and publication gates still apply.</p>
  </details>;
}
