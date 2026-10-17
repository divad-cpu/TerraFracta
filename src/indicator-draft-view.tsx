"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { checkedResponsibilityContext } from "./responsibility-draft.ts";
import { indicatorFieldLabels, indicatorMissingReasons, indicatorBasisDifferences, indicatorDraftFromEntries, indicatorDraftFeedbackFromEntries, indicatorDraftJson, reopenIndicatorDraftJson,
  INDICATOR_DRAFT_BYTES, INDICATOR_DRAFT_ENTRIES, type IndicatorDraft, type IndicatorField, type IndicatorDraftFeedback } from "./indicator-draft.ts";
import { scopeReferenceKey, type ScopeDraftContext } from "./issue-scope-draft.ts";
import { policyEventControlEntries as privateControlEntries, preparationReferenceValues } from "./policy-event-controls.ts";
import { preparationInputIntent, type PreparationInputIntents } from "./preparation-input-intent.ts";
import { matchingScopeReferenceKeys } from "./issue-scope-reference-search.ts";
import { recordedProposalReferenceAnchor } from "./recorded-reference-differences.ts";
type Entry = IndicatorDraft["entries"][number];
type Row = { id: number; initial: Entry | null; references: Record<IndicatorField, string[]>; referenceHeld: Record<IndicatorField, boolean> };
type Editing = { key: string; generation: number; revision: number; rows: Row[]; pasted: string; preview: IndicatorDraft | null; json: string | null; held: boolean };
const fields = Object.keys(indicatorFieldLabels) as IndicatorField[];
const indicatorChoices: Partial<Record<IndicatorField, Record<string, string>>> = { missingReason: indicatorMissingReasons };
const coverageLabels = { none: "No entries supply this field", some: "Some entries omit this field", all: "Every entry supplies this field" };
const spellingLabels = { no_text: "No text to compare", one_text: "Only one supplied text", same_spelling: "Supplied texts have the same spelling", different_text: "Supplied texts differ" };

// Reuse the form-free synchronous control reader. No series joining, numeric
// calculation, transport, File read, persistence or publication port is present.
export function IndicatorDraftView({ context: input }: { context: ScopeDraftContext }) {
  const checked = checkedResponsibilityContext(input), key = checked?.key ?? null, prefix = useId();
  const latest = useRef({ key, generation: 0 }), visit = useRef<object | null>(null), serial = useRef(0);
  const revision = useRef(0), inputEpoch = useRef(0), controls = useRef<HTMLFieldSetElement | null>(null);
  const intents = useRef<PreparationInputIntents>({ epoch: -1, controls: new Map() });
  const queryEpoch = useRef(0), queryRevision = useRef(0);
  const queryIntents = useRef<PreparationInputIntents>({ epoch: -1, controls: new Map() });
  const [search, setSearch] = useState<{ key: string; generation: number; query: string; fault: boolean } | null>(null);
  const [owner, setOwner] = useState<object | null>(null), [editing, setEditing] = useState<Editing | null>(null);
  const [heldFeedback, setHeldFeedback] = useState<{ key: string; generation: number; revision: number; value: IndicatorDraftFeedback | null } | null>(null);
  if (latest.current.key !== key) { latest.current = { key, generation: latest.current.generation + 1 }; visit.current = null; }
  const generation = latest.current.generation, epoch = inputEpoch.current, searchEpoch = queryEpoch.current, searchRevision = queryRevision.current;
  const frameRevision = revision.current;
  const admitted = key !== null && owner !== null && visit.current === owner && editing?.key === key && editing.generation === generation;
  const state = admitted ? editing : null, shown = state?.revision === revision.current ? state : null;
  const feedback = shown?.held && heldFeedback?.key === key && heldFeedback.generation === generation && heldFeedback.revision === revision.current ? heldFeedback.value : null;
  const current = () => admitted && visit.current === owner && latest.current.key === key && latest.current.generation === generation;
  const ownsInput = () => current() && inputEpoch.current === epoch;
  const ownsAction = () => ownsInput() && state?.revision === revision.current;
  useLayoutEffect(() => () => { visit.current = null; }, []);
  useEffect(() => {
    setHeldFeedback(null); queryEpoch.current++; queryRevision.current++;
    setSearch(key === null ? null : { key, generation, query: "", fault: false });
    if (key === null) { visit.current = null; setOwner(null); setEditing(null); return; }
    const token = {}; visit.current = token; inputEpoch.current++;
    setEditing({ key, generation, revision: ++revision.current, rows: [], pasted: "", preview: null, json: null, held: false }); setOwner(token);
    return () => { if (visit.current === token) visit.current = null; };
  }, [key, generation]);
  if (!checked) return <section><h2>Indicator preparation unavailable</h2><p>No captured indicator worksheet is shown.</p></section>;
  const context = checked.context, claims = context.claims.map((claim, index) => ({ ...claim, statementNumber: index + 1 })).filter(claim => claim.type === "condition" || claim.type === "attributed_finding");
  const choices = context.claims.flatMap((claim, statementIndex) => claim.evidence.map((source, index) => ({ key: scopeReferenceKey(claim.id, index + 1),
    href: `#${recordedProposalReferenceAnchor("proposed", claim.id, index)}`,
    label: `Proposed statement ${statementIndex + 1} · reference ${index + 1}: ${source.title} · ${source.locator} · original role: ${source.relation}` })));
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
  function changeReferences(id: number, field: IndicatorField, event: { readonly currentTarget: HTMLSelectElement }) {
    const owns = preparationInputIntent(intents, epoch, `${id}:${field}:references`, ownsInput); if (!owns) return;
    revision.current++;
    try {
      const target = event.currentTarget; if (!owns()) return;
      const values = preparationReferenceValues(target, owns); if (!owns()) return;
      if (new Set(values).size !== values.length || values.some(value => !choiceKeys.has(value))) throw new Error("Indicator choice held");
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
  function replace(rows: Row[], pasted = "", preview: IndicatorDraft | null = null, json: string | null = null) {
    if (!ownsAction() || key === null || rows.length > INDICATOR_DRAFT_ENTRIES) return;
    inputEpoch.current++; const next = ++revision.current;
    setEditing(old => current() ? { key, generation, revision: next, rows, pasted, preview, json, held: false } : old);
  }
  function changed() {
    if (!ownsInput()) return;
    const next = ++revision.current; setEditing(old => current() && old ? { ...old, revision: next, preview: null, json: null, held: false } : old);
  }
  function inspect() {
    if (!ownsAction()) return;
    const operation = ++revision.current, owns = () => current() && inputEpoch.current === epoch && revision.current === operation;
    try {
      if (state!.rows.some(row => fields.some(field => row.referenceHeld[field]))) throw new Error("Indicator selection needs explicit correction");
      const root = controls.current; if (!root || !owns()) throw new Error("Indicator controls unavailable");
      const data = privateControlEntries(root, owns); if (!owns()) return;
      const preview = indicatorDraftFromEntries(data, state!.rows.map(row => row.id), context), json = preview ? indicatorDraftJson(preview, context) : null;
      const value = json === null ? indicatorDraftFeedbackFromEntries(data, state!.rows.map(row => row.id), context) : null;
      if (!owns() || key === null) return;
      setHeldFeedback({ key, generation, revision: operation, value });
      setEditing(old => owns() && old ? { ...old, revision: operation, preview: json === null ? null : preview, json, held: json === null } : old);
    } catch {
      if (owns()) setHeldFeedback(null);
      setEditing(old => owns() && old ? { ...old, revision: operation, preview: null, json: null, held: true } : old);
    }
  }
  function reopen() {
    if (!ownsAction() || !state) return;
    const value = reopenIndicatorDraftJson(state.pasted, context);
    if (!ownsAction()) return;
    if (value) replace(value.entries.map(newRow), state.pasted, value, indicatorDraftJson(value, context));
    else { const next = ++revision.current; setEditing(old => ownsInput() && revision.current === next && old ? { ...old, revision: next, preview: null, json: null, held: true } : old); }
  }
  return <details className="issue-scope-preparation"><summary>Prepare unsent indicator details</summary>
    <h2>Indicator preparation</h2>
    <p>This private worksheet keeps source-described indicator meaning beside an observation. It establishes no series identity, factual acceptance, comparability, trend or policy effect.</p>
    <p>Preserve the definition and version, unit and scale, geographic coverage, population and denominator, adjustment and frequency. Identical labels are not proof of an identical series. A changed definition or population must not be silently joined.</p>
    <p>Keep observation period and revision or vintage separate from source publication and retrieval dates. Entries retain worksheet order, never inferred time order. No interpolation, arithmetic, aggregation or missing-as-zero conversion is performed.</p>
    <p>A source-stated missing reason and a numeric value cannot both be supplied. Both can be unknown. Every supplied field needs its own exact references; an original statement's support, conflict or context role does not establish support for the new interpretation. A missing reason is an unsent source-described preparation, not an operational failure receipt.</p>
    <p id={`${prefix}-limits`}>Use exact decimal text without grouping or exponents, at most 24 integer digits and nine decimal places; values are never rounded. Keep at most four entries, 12 distinct references per field and 16 KiB for the bounded worksheet input and complete copied preparation. Unknown fields need blank values and no selected references. Hold the usual modifier key to choose multiple references.</p>
    {!claims.length ? <p>No proposed condition or attributed-finding statement is available in this captured comparison. Other statement types are not converted into observations.</p> : <>
      <label htmlFor={`${prefix}-reference-search`}>Find indicator reference choices</label>
      <input id={`${prefix}-reference-search`} type="search" maxLength={80} value={query} disabled={!admitted} onChange={changeQuery} />
      <button type="button" disabled={!admitted || (!query && !search?.fault)} onClick={clearQuery}>Show all indicator reference choices</button>
      <p id={`${prefix}-reference-search-status`} role="status" aria-live="polite">{matches === null ? "Reference search is invalid or unavailable. Matching choices are withheld; selected choices remain." : `${matches.length} of ${choices.length} recorded reference choices match.`} Search the recorded statement type, period, title, locator or relation. All words must match one occurrence. Selected choices remain visible outside the filter with their original numbers. Searching changes no preparation values, references or review status.</p>
      <fieldset ref={controls} aria-label="Unsent indicator controls" disabled={!admitted} onChange={changed}>
        {state?.rows.map((row, index) => { const hint = feedback?.entries[index]; return <fieldset key={row.id}><legend>Indicator entry {index + 1}</legend>
          {hint?.duplicate && <p id={`${prefix}-${row.id}-duplicate-error`}>This entry exactly repeats an earlier entry. Correct or remove it; no automatic merge is made.</p>}
          {hint?.valueAndMissingReason && <p id={`${prefix}-${row.id}-missingness-error`}>Supply an observation or one source-stated missing reason, never both. Both can be unknown.</p>}
          <label htmlFor={`${prefix}-${row.id}-claim`}>Associated proposed measured-condition or attributed-finding statement</label>
          <select id={`${prefix}-${row.id}-claim`} name={`${row.id}.claim`} defaultValue={row.initial?.claimId ?? ""} disabled={!admitted}
            aria-invalid={hint?.statement || undefined} aria-describedby={hint?.statement ? `${prefix}-${row.id}-statement-error` : undefined}>
            <option value="">Choose a statement</option>{claims.map(claim => <option key={claim.id} value={claim.id}>Proposed statement {claim.statementNumber} · {claim.periodLabel}</option>)}
          </select>
          {hint?.statement && <p id={`${prefix}-${row.id}-statement-error`}>Choose a proposed condition or attributed-finding statement from this captured comparison.</p>}
          {fields.map(field => { const options = indicatorChoices[field], value = row.initial?.fields[field]?.value ?? "", error = hint?.fields[field];
            const valueHint = `${prefix}-limits${error?.value ? ` ${prefix}-${row.id}-${field}-value-error` : ""}`;
            return <div key={field}><label htmlFor={`${prefix}-${row.id}-${field}`}>{indicatorFieldLabels[field]}</label>
              {options ? <select id={`${prefix}-${row.id}-${field}`} name={`${row.id}.${field}`} defaultValue={value} disabled={!admitted}
                aria-invalid={error?.value || undefined} aria-describedby={valueHint}>
                <option value="">Unknown</option>{Object.entries(options).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select> : <input id={`${prefix}-${row.id}-${field}`} name={`${row.id}.${field}`} defaultValue={value} disabled={!admitted}
                aria-invalid={error?.value || undefined} aria-describedby={valueHint} />}
              {error?.value && <p id={`${prefix}-${row.id}-${field}-value-error`}>Supply a permitted value, or clear both the value and references to leave it unknown. An observation and a missing reason cannot both be supplied.</p>}
              <label htmlFor={`${prefix}-${row.id}-${field}-refs`}>References for {indicatorFieldLabels[field]}</label>
              <select id={`${prefix}-${row.id}-${field}-refs`} name={`${row.id}.${field}References`} multiple size={Math.min(4, choices.length)} disabled={!admitted}
                value={row.references[field]} onChange={event => changeReferences(row.id, field, event)}
                aria-invalid={error?.references || (shown && row.referenceHeld[field]) || undefined} aria-describedby={`${prefix}-reference-search-status${error?.references ? ` ${prefix}-${row.id}-${field}-references-error` : ""}${shown && row.referenceHeld[field] ? ` ${prefix}-${row.id}-${field}-selection-held` : ""}`}>
                {choices.filter(choice => matched.has(choice.key) || row.references[field].includes(choice.key)).map(choice => <option key={choice.key} value={choice.key}>{choice.label}{!matched.has(choice.key) ? " · Selected outside this filter" : ""}</option>)}
              </select>
              {shown && row.referenceHeld[field] && <p id={`${prefix}-${row.id}-${field}-selection-held`}>Reference selection not applied. Previous choices remain. Explicitly choose up to 12 distinct references from this captured comparison before inspection; nothing is truncated or substituted.</p>}
              {error?.references && <p id={`${prefix}-${row.id}-${field}-references-error`}>Choose 1–12 distinct exact references from this captured comparison for the supplied field. Unknown fields need no selected references.</p>}
            </div>;
          })}
          <button id={`${prefix}-${row.id}-remove`} type="button" disabled={!admitted} onClick={() => replace(state.rows.filter(value => value.id !== row.id))}>Remove indicator entry {index + 1}</button>
        </fieldset>; })}
        <button type="button" disabled={!admitted || (state?.rows.length ?? 0) >= INDICATOR_DRAFT_ENTRIES}
          onClick={() => { if (ownsAction() && state && state.rows.length < INDICATOR_DRAFT_ENTRIES) replace([...state.rows, newRow(null)]); }}>Add indicator entry</button>
        <button type="button" disabled={!admitted} onClick={inspect}>Inspect unsent indicator draft</button>
        <button type="button" disabled={!admitted} onClick={clearDraft}>Clear indicator draft</button>
      </fieldset>
      {shown?.held && <p role="status">Indicator preparation held. Check the measured statement, exclusive value or missing reason, field values, distinct references and complete 16 KiB limit. Previous preview is withheld.</p>}
      {feedback?.size && <p role="status">{feedback.size === "input"
        ? "The bounded worksheet input exceeds 16 KiB. Reduce the supplied material; no value is truncated."
        : "The complete copied preparation exceeds 16 KiB even though its individual fields pass structural checks. Reduce the supplied material; no field is marked wrong only because of the complete size."}</p>}
      {feedback?.tooMany && <p role="status">Keep at most four indicator entries. No entries were merged or removed automatically.</p>}
      {feedback && feedback.entries.some(entry => entry.statement || entry.duplicate || fields.some(field => entry.fields[field].value || entry.fields[field].references)) && <ul aria-label="Indicator corrections">
        {state?.rows.flatMap((row, index) => { const hint = feedback.entries[index]; if (!hint) return []; return [
          hint.statement && <li key={`${row.id}-statement`}><a href={`#${prefix}-${row.id}-claim`}>Entry {index + 1}: choose the associated statement</a></li>,
          hint.duplicate && <li key={`${row.id}-duplicate`}><a href={`#${prefix}-${row.id}-remove`}>Entry {index + 1}: correct or remove the repeated entry</a></li>,
          ...fields.flatMap(field => [hint.fields[field].value && <li key={`${row.id}-${field}-value`}><a href={`#${prefix}-${row.id}-${field}`}>Entry {index + 1}: correct {indicatorFieldLabels[field]}</a></li>,
            hint.fields[field].references && <li key={`${row.id}-${field}-refs`}><a href={`#${prefix}-${row.id}-${field}-refs`}>Entry {index + 1}: correct references for {indicatorFieldLabels[field]}</a></li>]),
        ]; })}
      </ul>}
      {shown?.preview && shown.json !== null && <section><h3>Unsent indicator draft</h3>
        <p>Entries retain worksheet order. They are not a series, chronology, trend or proof of a policy effect. No entries or unknown values do not establish absence of a measured problem.</p>
        <ol>{shown.preview.entries.map((entry, index) => <li key={index}>
          <p><a href={`#proposal-proposed-claim-${entry.claimId}`}>Inspect associated proposed indicator statement</a></p>
          <dl>{fields.map(name => { const field = entry.fields[name]; return <div key={name}><dt>{indicatorFieldLabels[name]}</dt>
            <dd>{field === null ? "Unknown — no value or references supplied" : <><p>{indicatorChoices[name]?.[field.value] ?? field.value}</p>
              <ul>{field.references.map(ref => { const source = choices.find(choice => choice.key === scopeReferenceKey(ref.claimId, ref.referenceNumber))!;
                return <li key={source.key}><a href={source.href}>{source.label}</a></li>; })}</ul></>}</dd>
          </div>; })}</dl>
        </li>)}</ol>
        {shown.preview.entries.length >= 2 && <div className="indicator-basis-comparison" role="region" aria-label="Indicator metadata comparison" tabIndex={0}>
          <h3>Inspect definition and coverage differences</h3>
          <p>These cells compare supplied text only. Missing fields and different supplied texts are independent warnings. Equal spelling does not establish identity, independent evidence or comparability. Observation values are not compared or connected by a line.</p>
          <table><caption>Source-described metadata in worksheet order; no series join or trend calculation</caption>
            <thead><tr><th scope="col">Metadata</th>{shown.preview.entries.map((_entry, index) => <th scope="col" key={index}>Entry {index + 1}</th>)}<th scope="col">Coverage and spelling</th></tr></thead>
            <tbody>{indicatorBasisDifferences(shown.preview, context)!.map(row => <tr key={row.field}>
              <th scope="row">{indicatorFieldLabels[row.field]}</th>{row.values.map((value, index) => <td key={index}>{value ?? "Unknown — no value supplied"}</td>)}
              <td>{coverageLabels[row.coverage]}. {spellingLabels[row.spelling]}.</td>
            </tr>)}</tbody>
          </table>
        </div>}
        <label htmlFor={`${prefix}-json`}>Exact copied indicator preparation</label><textarea id={`${prefix}-json`} readOnly rows={12} value={shown.json} />
      </section>}
      <label htmlFor={`${prefix}-paste`}>Paste exact saved indicator preparation</label>
      <textarea id={`${prefix}-paste`} value={state?.pasted ?? ""} disabled={!admitted} maxLength={INDICATOR_DRAFT_BYTES} onChange={event => {
        const owns = preparationInputIntent(intents, epoch, "pasted-indicator", ownsInput); if (!owns) return;
        const value = event.currentTarget.value; if (!owns()) return;
        const next = ++revision.current; setEditing(old => owns() && old ? { ...old, revision: next, pasted: value, preview: null, json: null, held: false } : old);
      }} />
      <button type="button" disabled={!admitted} onClick={reopen}>Reopen indicator preparation</button>
    </>}
    <details><summary>Inspect exact reference choices</summary><ul>{choices.map(choice => <li key={choice.key}><a href={choice.href}>{choice.label}</a></li>)}</ul></details>
  </details>;
}
