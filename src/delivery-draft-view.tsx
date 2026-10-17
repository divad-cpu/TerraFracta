"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { checkedResponsibilityContext } from "./responsibility-draft.ts";
import { deliveryStages, deliveryFieldLabels, deliveryDraftFromEntries, deliveryDraftJson,
  reopenDeliveryDraftJson, DELIVERY_DRAFT_BYTES, DELIVERY_DRAFT_ENTRIES,
  deliveryCorrectionFields, deliveryDraftFeedbackFromEntries,
  type DeliveryDraft, type DeliveryField, type DeliveryFieldFeedback } from "./delivery-draft.ts";
import { scopeReferenceKey, type ScopeDraftContext } from "./issue-scope-draft.ts";
import { recordedProposalReferenceAnchor } from "./recorded-reference-differences.ts";
import { preparationInputIntent, type PreparationInputIntents } from "./preparation-input-intent.ts";
import { preparedEventDateLabel } from "./policy-event-draft.ts";
import { preparationDateFeedback, preparationDatePrefixes, type PreparationDateFeedback, type PreparationDateField } from "./preparation-date-feedback.ts";
import { matchingScopeReferenceKeys } from "./issue-scope-reference-search.ts";
import { policyEventControlEntries, preparationReferenceValues } from "./policy-event-controls.ts";
type Entry = DeliveryDraft["entries"][number];
type Row = { id: number; initial: Entry | null; references: Record<DeliveryField, string[]>; referenceHeld: Record<DeliveryField, boolean> };
type Editing = { key: string; generation: number; revision: number; rows: Row[]; pasted: string;
  preview: DeliveryDraft | null; json: string | null; held: boolean };

const fields = Object.keys(deliveryFieldLabels) as DeliveryField[];

// Only synchronous, in-memory form inspection and exact copied-text reopening.
// No submit endpoint, File read, clipboard, storage, download or publication port.
export function DeliveryDraftView({ context: input }: { context: ScopeDraftContext }) {
  const checked = checkedResponsibilityContext(input), key = checked?.key ?? null, prefix = useId();
  const latest = useRef({ key, generation: 0 }), visit = useRef<object | null>(null);
  const serial = useRef(0), revision = useRef(0), inputEpoch = useRef(0);
  const controls = useRef<HTMLFieldSetElement | null>(null);
  const intents = useRef<PreparationInputIntents>({ epoch: -1, controls: new Map() });
  const queryEpoch = useRef(0), queryRevision = useRef(0);
  const queryIntents = useRef<PreparationInputIntents>({ epoch: -1, controls: new Map() });
  const [search, setSearch] = useState<{ key: string; generation: number; query: string; fault: boolean } | null>(null);
  const [owner, setOwner] = useState<object | null>(null), [editing, setEditing] = useState<Editing | null>(null);
  const [dateFeedback, setDateFeedback] = useState<{ key: string; generation: number; revision: number; value: PreparationDateFeedback | null } | null>(null);
  const [fieldFeedback, setFieldFeedback] = useState<{ key: string; generation: number; revision: number; value: DeliveryFieldFeedback | null } | null>(null);
  if (latest.current.key !== key) { latest.current = { key, generation: latest.current.generation + 1 }; visit.current = null; }
  const generation = latest.current.generation, epoch = inputEpoch.current, searchEpoch = queryEpoch.current, searchRevision = queryRevision.current;
  const frameRevision = revision.current;
  const admitted = key !== null && owner !== null && visit.current === owner && editing?.key === key && editing.generation === generation;
  const state = admitted ? editing : null;
  const shown = state?.revision === revision.current ? state : null;
  const dateHints = shown?.held && dateFeedback?.key === key && dateFeedback.generation === generation && dateFeedback.revision === revision.current ? dateFeedback.value : null;
  const fieldHints = shown?.held && fieldFeedback?.key === key && fieldFeedback.generation === generation && fieldFeedback.revision === revision.current ? fieldFeedback.value : null;
  const current = () => admitted && visit.current === owner && latest.current.key === key && latest.current.generation === generation;
  const ownsInput = () => current() && inputEpoch.current === epoch;
  const ownsAction = () => ownsInput() && state?.revision === revision.current;
  useLayoutEffect(() => () => { visit.current = null; }, []);
  useEffect(() => {
    setDateFeedback(null);
    setFieldFeedback(null);
    queryEpoch.current++; queryRevision.current++;
    setSearch(key === null ? null : { key, generation, query: "", fault: false });
    if (key === null) { visit.current = null; setOwner(null); setEditing(null); return; }
    const token = {}; visit.current = token; inputEpoch.current++;
    setEditing({ key, generation, revision: ++revision.current, rows: [], pasted: "", preview: null, json: null, held: false }); setOwner(token);
    return () => { if (visit.current === token) visit.current = null; };
  }, [key, generation]);
  if (!checked) return <section><h2>Delivery preparation unavailable</h2><p>No captured delivery worksheet is shown.</p></section>;
  const context = checked.context, claims = context.claims.map((claim, index) => ({ ...claim, statementNumber: index + 1 })).filter(claim => claim.type === "delivery");
  const choices = context.claims.flatMap((claim, statementIndex) => claim.evidence.map((source, index) => ({
    key: scopeReferenceKey(claim.id, index + 1), href: `#${recordedProposalReferenceAnchor("proposed", claim.id, index)}`,
    label: `Proposed statement ${statementIndex + 1} · reference ${index + 1}: ${source.title} · ${source.locator} · original role: ${source.relation}`,
  })));
  const query = admitted && search?.key === key && search.generation === generation ? search.query : "";
  const matches = search?.key === key && search.generation === generation && search.fault ? null : matchingScopeReferenceKeys(context, query);
  const matched = new Set(matches ?? []), choiceKeys = new Set(choices.map(choice => choice.key));
  function newRow(initial: Entry | null): Row {
    return { id: ++serial.current, initial,
      references: Object.fromEntries(fields.map(field => [field, initial?.fields[field]?.references.map(ref => scopeReferenceKey(ref.claimId, ref.referenceNumber)) ?? []])) as Row["references"],
      referenceHeld: Object.fromEntries(fields.map(field => [field, false])) as Row["referenceHeld"] };
  }
  function changeQuery(event: { readonly currentTarget: HTMLInputElement }) {
    const owns = preparationInputIntent(queryIntents, searchEpoch, "query", () => ownsInput() && queryEpoch.current === searchEpoch);
    if (!owns) return;
    try {
      const target = event.currentTarget; if (!owns()) return;
      const value = target.value; if (!owns() || typeof value !== "string") return;
      queryRevision.current++;
      setSearch(old => owns() && key !== null ? { key, generation, query: value, fault: false } : old);
    } catch {
      if (!owns()) return; queryRevision.current++;
      setSearch(old => owns() && key !== null ? { key, generation, query: old?.key === key ? old.query : "", fault: true } : old);
    }
  }
  function clearQuery() {
    if (!ownsInput() || queryEpoch.current !== searchEpoch || queryRevision.current !== searchRevision || key === null) return;
    queryEpoch.current++; queryRevision.current++;
    setSearch({ key, generation, query: "", fault: false });
  }
  function changeReferences(id: number, field: DeliveryField, event: { readonly currentTarget: HTMLSelectElement }) {
    const owns = preparationInputIntent(intents, epoch, `${id}:${field}:references`, ownsInput); if (!owns) return;
    revision.current++;
    try {
      const target = event.currentTarget; if (!owns()) return;
      const values = preparationReferenceValues(target, owns); if (!owns()) return;
      if (new Set(values).size !== values.length || values.some(value => !choiceKeys.has(value))) throw new Error("Delivery choice held");
      setEditing(old => owns() && old ? { ...old, revision: revision.current,
        rows: old.rows.map(row => row.id === id ? { ...row, references: { ...row.references, [field]: values }, referenceHeld: { ...row.referenceHeld, [field]: false } } : row),
        preview: null, json: null, held: false } : old);
    } catch {
      setEditing(old => owns() && old ? { ...old, revision: revision.current,
        rows: old.rows.map(row => row.id === id ? { ...row, referenceHeld: { ...row.referenceHeld, [field]: true } } : row),
        preview: null, json: null, held: true } : old);
    }
  }
  function clearDraft() {
    // A newly represented Clear may cancel an input whose eager revision has
    // retired its old preview. A retained pre-input Clear stays retired.
    if (!ownsInput() || frameRevision !== revision.current || key === null) return;
    queryEpoch.current++; queryRevision.current++; setSearch({ key, generation, query: "", fault: false });
    inputEpoch.current++; const next = ++revision.current;
    setEditing(old => current() ? { key, generation, revision: next, rows: [], pasted: "", preview: null, json: null, held: false } : old);
  }
  function replace(rows: Row[], pasted = "", preview: DeliveryDraft | null = null, json: string | null = null) {
    if (!ownsAction() || key === null || rows.length > DELIVERY_DRAFT_ENTRIES) return;
    inputEpoch.current++; const next = ++revision.current;
    setEditing(old => current() ? { key, generation, revision: next, rows, pasted, preview, json, held: false } : old);
  }
  function changed() {
    if (!ownsInput()) return;
    const next = ++revision.current;
    setEditing(old => current() && old ? { ...old, revision: next, preview: null, json: null, held: false } : old);
  }
  function inspect() {
    if (!ownsAction()) return;
    const operation = ++revision.current, owns = () => current() && inputEpoch.current === epoch && revision.current === operation;
    try {
      if (state!.rows.some(row => fields.some(field => row.referenceHeld[field]))) throw new Error("Delivery selection needs explicit correction");
      const root = controls.current; if (!root || !owns()) throw new Error("Event controls unavailable");
      const data = policyEventControlEntries(root, owns); if (!owns()) return;
      const preview = deliveryDraftFromEntries(data, state!.rows.map(row => row.id), context);
      const json = preview ? deliveryDraftJson(preview, context) : null;
      const hints = json === null ? preparationDateFeedback(data, state!.rows.map(row => row.id), context, "delivery") : null;
      const correction = json === null ? deliveryDraftFeedbackFromEntries(data, state!.rows.map(row => row.id), context) : null;
      if (!owns() || key === null) return;
      setDateFeedback({ key, generation, revision: operation, value: hints });
      setFieldFeedback({ key, generation, revision: operation, value: correction });
      setEditing(old => owns() && old ? { ...old, revision: operation, preview: json === null ? null : preview, json, held: json === null } : old);
    } catch {
      setEditing(old => owns() && old ? { ...old, revision: operation, preview: null, json: null, held: true } : old);
    }
  }
  function reopen() {
    if (!ownsAction() || !state) return;
    const value = reopenDeliveryDraftJson(state.pasted, context);
    if (!ownsAction()) return;
    if (value) replace(value.entries.map(newRow), state.pasted, value, deliveryDraftJson(value, context));
    else { const next = ++revision.current; setEditing(old => ownsInput() && revision.current === next && old ? { ...old, revision: next, preview: null, json: null, held: true } : old); }
  }
  function references(row: Row, field: DeliveryField) {
    const hint = field === "eventDate" || field === "reportedDate" ? dateHints?.[String(row.id)]?.[field] : null;
    const correction = field === "stage" || field === "description" || field === "coverage" ? fieldHints?.[String(row.id)]?.fields[field] : null;
    return <><label htmlFor={`${prefix}-${row.id}-${field}-refs`}>References for {deliveryFieldLabels[field]}</label>
      <select id={`${prefix}-${row.id}-${field}-refs`} name={`${row.id}.${field}References`} multiple size={Math.min(4, choices.length)}
        value={row.references[field]} disabled={!admitted} onChange={event => changeReferences(row.id, field, event)}
        aria-invalid={(shown && row.referenceHeld[field]) || hint?.references || correction?.references || undefined} aria-describedby={`${prefix}-reference-search-status${shown && row.referenceHeld[field] ? ` ${prefix}-${row.id}-${field}-selection-held` : ""}${hint?.references ? ` ${prefix}-${row.id}-${field}-date-references-error` : ""}${correction?.references ? ` ${prefix}-${row.id}-${field}-references-error` : ""}`}>
        {choices.filter(choice => matched.has(choice.key) || row.references[field].includes(choice.key)).map(choice => <option key={choice.key} value={choice.key}>{choice.label}{!matched.has(choice.key) ? " · Selected outside this filter" : ""}</option>)}
      </select>{hint?.references && <p id={`${prefix}-${row.id}-${field}-date-references-error`}>Choose 1–12 distinct exact captured references for this supplied date. Clear all date controls and references to leave it unknown.</p>}
      {correction?.references && <p id={`${prefix}-${row.id}-${field}-references-error`}>Choose 1–12 distinct exact captured references for this supplied field. Clear its value and references to leave it unknown. A reference choice does not establish the source's meaning.</p>}
      {shown && row.referenceHeld[field] && <p id={`${prefix}-${row.id}-${field}-selection-held`}>Reference selection not applied. Previous choices remain. Explicitly choose up to 12 distinct references from this captured comparison before inspection; nothing is truncated or substituted.</p>}</>;
  }
  function date(row: Row, field: "eventDate" | "reportedDate", name: "event" | "reported") {
    const hint = dateHints?.[String(row.id)]?.[field];
    const initial = row.initial?.fields[field]?.date, precision = initial?.precision ?? "";
    const value = initial ? initial.precision === "period" ? initial.label : "value" in initial ? initial.value : "" : "";
    return <div><label htmlFor={`${prefix}-${row.id}-${name}-precision`}>{deliveryFieldLabels[field]} — precision</label>
      <select id={`${prefix}-${row.id}-${name}-precision`} name={`${row.id}.${name}Precision`} defaultValue={precision} disabled={!admitted} aria-invalid={hint?.precision || undefined} aria-describedby={hint?.precision ? `${prefix}-${row.id}-${field}-date-precision-error` : undefined}>
        <option value="">Unknown</option><option value="day">Exact day</option><option value="month">Month only</option><option value="year">Year only</option><option value="period">Stated period</option>
      </select>
      <label htmlFor={`${prefix}-${row.id}-${name}-value`}>{deliveryFieldLabels[field]} — value</label>
      <input id={`${prefix}-${row.id}-${name}-value`} name={`${row.id}.${name}Value`} defaultValue={value} disabled={!admitted} aria-invalid={hint?.value || undefined} aria-describedby={hint?.value ? `${prefix}-${row.id}-${field}-date-value-error` : undefined} />
      {hint?.precision && <p id={`${prefix}-${row.id}-${field}-date-precision-error`}>Choose the source's exact day, month, year or stated-period precision, or clear all date controls and references to leave it unknown. No precision is guessed.</p>}
      {hint?.value && <p id={`${prefix}-${row.id}-${field}-date-value-error`}>Supply a valid value matching the chosen source precision: YYYY-MM-DD, YYYY-MM, YYYY, or the stated period label. No day is invented or date corrected automatically.</p>}
      {references(row, field)}</div>;
  }
  return <details className="issue-scope-preparation"><summary>Prepare unsent delivery details</summary>
    <h2>Delivery preparation</h2>
    <p>This private worksheet records a source-described delivery stage, description and coverage. A policy announcement, adoption, budget or payment is not evidence that a service operates. A completed label does not fill an unknown date, coverage or responsible authority.</p>
    <p>Not started, pilot, partial, operating, paused, completed and cancelled are separate source-described stages, not a score or automatic sequence. Do not promote a stage from the clock or infer national coverage from a local delivery report. Entries are not automatically matched to measures or institutions.</p>
    <p>Keep event time separate from the source's reporting time. Enter YYYY-MM-DD for an exact day, YYYY-MM for a month, YYYY for a year, or the source's stated period. Unknown fields need blank values and no selected references. A future date is not proof that delivery occurred; never substitute retrieval time or guess a day.</p>
    <p>Every supplied field needs its own exact references. An original statement's support, conflict or context role does not establish support for the new delivery interpretation. Hold the usual modifier key to choose multiple references. Keep at most eight entries, 12 references per supplied field and 16 KiB for the complete copied preparation; values outside the limits are held.</p>
    {!claims.length ? <p>No proposed delivery statement is available in this captured comparison. Other statement types are not converted into delivery records.</p> : <>
      <label htmlFor={`${prefix}-reference-search`}>Find delivery reference choices</label>
      <input id={`${prefix}-reference-search`} type="search" maxLength={80} value={query} disabled={!admitted} onChange={changeQuery} />
      <button type="button" disabled={!admitted || (!query && !search?.fault)} onClick={clearQuery}>Show all delivery reference choices</button>
      <p id={`${prefix}-reference-search-status`} role="status" aria-live="polite">{matches === null ? "Reference search is invalid or unavailable. Matching choices are withheld; selected choices remain." : `${matches.length} of ${choices.length} recorded reference choices match.`} Search the recorded statement type, period, title, locator or relation. All words must match one occurrence. Selected choices remain visible outside the filter with their original numbers. Searching changes no preparation values, references or review status.</p>
      <fieldset ref={controls} aria-label="Unsent delivery controls" disabled={!admitted} onChange={changed}>
        {state?.rows.map((row, index) => <fieldset key={row.id}><legend>Delivery entry {index + 1}</legend>
          <label htmlFor={`${prefix}-${row.id}-claim`}>Associated proposed delivery statement</label>
          <select id={`${prefix}-${row.id}-claim`} name={`${row.id}.claim`} defaultValue={row.initial?.claimId ?? ""} disabled={!admitted} aria-invalid={fieldHints?.[String(row.id)]?.statement || undefined} aria-describedby={fieldHints?.[String(row.id)]?.statement ? `${prefix}-${row.id}-statement-error` : undefined}>
            <option value="">Choose a statement</option>{claims.map(claim => <option key={claim.id} value={claim.id}>Proposed statement {claim.statementNumber} · {claim.periodLabel}</option>)}
          </select>
          {fieldHints?.[String(row.id)]?.statement && <p id={`${prefix}-${row.id}-statement-error`}>Choose an associated proposed delivery statement from this captured comparison. Other statement types are not converted into delivery records.</p>}
          <label htmlFor={`${prefix}-${row.id}-stage`}>Source-described delivery stage</label>
          <select id={`${prefix}-${row.id}-stage`} name={`${row.id}.stage`} defaultValue={row.initial?.fields.stage?.value ?? ""} disabled={!admitted} aria-invalid={fieldHints?.[String(row.id)]?.fields.stage.value || undefined} aria-describedby={fieldHints?.[String(row.id)]?.fields.stage.value ? `${prefix}-${row.id}-stage-value-error` : undefined}>
            <option value="">Unknown</option>{Object.entries(deliveryStages).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>{fieldHints?.[String(row.id)]?.fields.stage.value && <p id={`${prefix}-${row.id}-stage-value-error`}>Choose the source-described stage from the listed choices with its own references, or clear the stage and references to leave it unknown. No delivery stage is inferred or promoted.</p>}{references(row, "stage")}
          <label htmlFor={`${prefix}-${row.id}-description`}>Delivery description</label>
          <textarea id={`${prefix}-${row.id}-description`} name={`${row.id}.description`} defaultValue={row.initial?.fields.description?.wording ?? ""} disabled={!admitted} aria-invalid={fieldHints?.[String(row.id)]?.fields.description.value || undefined} aria-describedby={fieldHints?.[String(row.id)]?.fields.description.value ? `${prefix}-${row.id}-description-value-error` : undefined} />
          {fieldHints?.[String(row.id)]?.fields.description.value && <p id={`${prefix}-${row.id}-description-value-error`}>Supply nonblank delivery wording within the existing text limit, with its own references, or clear the description and references to leave it unknown. No wording is shortened or supplied automatically.</p>}
          {references(row, "description")}
          <label htmlFor={`${prefix}-${row.id}-coverage`}>Documented delivery coverage or scope</label>
          <textarea id={`${prefix}-${row.id}-coverage`} name={`${row.id}.coverage`} defaultValue={row.initial?.fields.coverage?.wording ?? ""} disabled={!admitted} aria-invalid={fieldHints?.[String(row.id)]?.fields.coverage.value || undefined} aria-describedby={fieldHints?.[String(row.id)]?.fields.coverage.value ? `${prefix}-${row.id}-coverage-value-error` : undefined} />
          {fieldHints?.[String(row.id)]?.fields.coverage.value && <p id={`${prefix}-${row.id}-coverage-value-error`}>Supply nonblank source-described delivery coverage within the existing text limit, with its own references, or clear coverage and references to leave it unknown. Local coverage is not treated as national coverage.</p>}
          {references(row, "coverage")}{date(row, "eventDate", "event")}{date(row, "reportedDate", "reported")}
          <button type="button" disabled={!admitted} onClick={() => replace(state.rows.filter(value => value.id !== row.id))}>Remove delivery entry {index + 1}</button>
        </fieldset>)}
        <button type="button" disabled={!admitted || (state?.rows.length ?? 0) >= DELIVERY_DRAFT_ENTRIES}
          onClick={() => { if (ownsAction() && state && state.rows.length < DELIVERY_DRAFT_ENTRIES) replace([...state.rows, newRow(null)]); }}>Add delivery entry</button>
        <button type="button" disabled={!admitted} onClick={inspect}>Inspect unsent delivery draft</button>
        <button type="button" disabled={!admitted} onClick={clearDraft}>Clear delivery draft</button>
      </fieldset>
      {shown?.held && <p role="status">Delivery preparation held. Check the statement, each field's wording or precision, distinct reference choices and the complete 16 KiB limit. Previous preview is withheld.</p>}
      {fieldHints && Object.values(fieldHints).some(row => row.statement || Object.values(row.fields).some(hint => hint.value || hint.references)) && <ul aria-label="Delivery field corrections">{state?.rows.flatMap((row, index) => {
        const hint = fieldHints[String(row.id)]; if (!hint) return [];
        return [hint.statement && <li key={`${row.id}-statement`}><a href={`#${prefix}-${row.id}-claim`}>Entry {index + 1}: choose the associated delivery statement</a></li>,
          ...deliveryCorrectionFields.flatMap(field => [
            hint.fields[field].value && <li key={`${row.id}-${field}-value`}><a href={`#${prefix}-${row.id}-${field}`}>Entry {index + 1}: correct value for {deliveryFieldLabels[field]}</a></li>,
            hint.fields[field].references && <li key={`${row.id}-${field}-references`}><a href={`#${prefix}-${row.id}-${field}-refs`}>Entry {index + 1}: correct references for {deliveryFieldLabels[field]}</a></li>,
          ])];
      })}</ul>}
      {dateHints && Object.values(dateHints).some(row => Object.values(row).some(hint => hint.precision || hint.value || hint.references)) && <ul aria-label="Delivery date corrections">{state?.rows.flatMap((row, index) => (Object.keys(preparationDatePrefixes) as PreparationDateField[]).flatMap(field => {
        const hint = dateHints[String(row.id)]?.[field], name = preparationDatePrefixes[field]; if (!hint) return [];
        return [hint.precision && <li key={`${row.id}-${field}-precision`}><a href={`#${prefix}-${row.id}-${name}-precision`}>Entry {index + 1}: correct precision for {deliveryFieldLabels[field]}</a></li>,
          hint.value && <li key={`${row.id}-${field}-value`}><a href={`#${prefix}-${row.id}-${name}-value`}>Entry {index + 1}: correct value for {deliveryFieldLabels[field]}</a></li>,
          hint.references && <li key={`${row.id}-${field}-references`}><a href={`#${prefix}-${row.id}-${field}-refs`}>Entry {index + 1}: correct references for {deliveryFieldLabels[field]}</a></li>];
      }))}</ul>}
      {shown?.preview && shown.json !== null && <section><h3>Unsent delivery draft</h3>
        <p>Entries retain worksheet order, not chronology or a current operating status. No entries or unknown fields do not establish absence of delivery. Source-described stages remain unreviewed preparations.</p>
        <ol>{shown.preview.entries.map((entry, index) => <li key={index}>
          <p><a href={`#proposal-proposed-claim-${entry.claimId}`}>Inspect associated proposed statement</a></p>
          <dl>{Object.entries(deliveryFieldLabels).map(([key, label]) => {
            const field = entry.fields[key as DeliveryField];
            return <div key={key}><dt>{label}</dt><dd>{field === null ? "Unknown — no value or references supplied" : <>
              <p>{"date" in field ? preparedEventDateLabel(field.date) : "wording" in field ? field.wording : deliveryStages[field.value]}</p>
              <ul>{field.references.map(ref => { const source = choices.find(choice => choice.key === scopeReferenceKey(ref.claimId, ref.referenceNumber))!;
                return <li key={source.key}><a href={source.href}>{source.label}</a></li>; })}</ul>
            </>}</dd></div>;
          })}</dl>
        </li>)}</ol>
        <label htmlFor={`${prefix}-json`}>Exact copied delivery preparation</label><textarea id={`${prefix}-json`} readOnly rows={12} value={shown.json} />
      </section>}
      <label htmlFor={`${prefix}-paste`}>Paste exact saved delivery preparation</label>
      <textarea id={`${prefix}-paste`} value={state?.pasted ?? ""} disabled={!admitted} maxLength={DELIVERY_DRAFT_BYTES} onChange={event => {
        const owns = preparationInputIntent(intents, epoch, "pasted-delivery", ownsInput); if (!owns) return;
        const value = event.currentTarget.value; if (!owns()) return;
        const next = ++revision.current;
        setEditing(old => owns() && old ? { ...old, revision: next, pasted: value, preview: null, json: null, held: false } : old);
      }} />
      <button type="button" disabled={!admitted} onClick={reopen}>Reopen delivery preparation</button>
    </>}
    <details><summary>Inspect exact reference choices</summary><ul>{choices.map(choice => <li key={choice.key}><a href={choice.href}>{choice.label}</a></li>)}</ul></details>
  </details>;
}
