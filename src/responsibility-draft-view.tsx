"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { checkedResponsibilityContext, checkResponsibilityDraft, responsibilityDraftJson, reopenResponsibilityDraftJson,
  responsibilityFieldLabels, RESPONSIBILITY_DRAFT_BYTES, RESPONSIBILITY_DRAFT_ENTRIES,
  responsibilityDraftFieldFeedback, type ResponsibilityDraftFeedback, type ResponsibilityDraft, type ResponsibilityField } from "./responsibility-draft.ts";
import { scopeReferenceKey, type ScopeDraftContext } from "./issue-scope-draft.ts";
import { recordedProposalReferenceAnchor } from "./recorded-reference-differences.ts";
import { statementLabels } from "./issue-display-labels.ts";
import { readResponsibilityDraftFile } from "./responsibility-file.ts";
import { withLocalRequestDeadline } from "./local-request-deadline.ts";
import { cancelLocalFileRead } from "./local-file-cancellation.ts";
import { matchingScopeReferenceKeys } from "./issue-scope-reference-search.ts";
import { preparationInputIntent, type PreparationInputIntents } from "./preparation-input-intent.ts";

type Fields = Record<ResponsibilityField, { wording: string; references: string[] }>;
type Row = { localId: number; claimId: string; fields: Fields };
type Held = { origin: "review"; fields: ResponsibilityDraftFeedback | null; tooLarge: boolean } | { origin: "reopen" };
type Editing = { key: string; revision: number; rows: Row[]; pasted: string; preview: ResponsibilityDraft | null; held: Held | null };
const fieldNames = Object.keys(responsibilityFieldLabels) as ResponsibilityField[];
const emptyFields = (): Fields => ({ institution: { wording: "", references: [] }, governmentLevel: { wording: "", references: [] },
  role: { wording: "", references: [] }, period: { wording: "", references: [] } });
const physicalResponsibilityFileReads = new Map<string, Promise<void>>();

// In-memory editing and bounded exact local reopening. No network, archive,
// diagnostic-body, source lookup, approval or publication port.
export function ResponsibilityDraftView({ context: input }: { context: ScopeDraftContext }) {
  const checked = checkedResponsibilityContext(input), key = checked?.key ?? null;
  const prefix = useId(), latest = useRef({ key, generation: 0 });
  const visit = useRef<object | null>(null), revision = useRef(0), inputEpoch = useRef(0), serial = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const fieldIntents = useRef<PreparationInputIntents>({ epoch: -1, controls: new Map() });
  const queryRevision = useRef(0), queryInputEpoch = useRef(0);
  const searchRevision = queryRevision.current, queryEpoch = queryInputEpoch.current;
  if (latest.current.key !== key) { latest.current = { key, generation: latest.current.generation + 1 }; visit.current = null; }
  const generation = latest.current.generation, actionRevision = revision.current, epoch = inputEpoch.current;
  const [owner, setOwner] = useState<{ key: string; generation: number; visit: object } | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [reading, setReading] = useState(false);
  const [filter, setFilter] = useState<{ key: string; query: string } | null>(null);
  const [fileState, setFileState] = useState<{ key: string; generation: number; state: "reading" | "held" | "busy" | "loaded" } | null>(null);
  const admitted = key !== null && owner?.key === key && owner.generation === generation && visit.current === owner.visit;
  const current = () => admitted && latest.current.key === key && latest.current.generation === generation && visit.current === owner?.visit;
  const ownsInput = () => current() && inputEpoch.current === epoch;
  const ownsAction = () => current() && revision.current === actionRevision && editing?.revision === actionRevision;
  useLayoutEffect(() => () => { visit.current = null; cancelLocalFileRead(pending.current); }, []);
  useEffect(() => {
    if (key === null) { visit.current = null; setOwner(null); return; }
    const token = {}; visit.current = token; inputEpoch.current++;
    queryRevision.current++; queryInputEpoch.current++; setFilter(null);
    const nextRevision = ++revision.current;
    setEditing({ key, revision: nextRevision, rows: [], pasted: "", preview: null, held: null });
    setFileState(null);
    const occupied = physicalResponsibilityFileReads.has(key);
    setReading(pending.current !== null || occupied);
    if (occupied && pending.current === null) void (async () => {
      while (physicalResponsibilityFileReads.get(key)) await physicalResponsibilityFileReads.get(key);
      if (visit.current === token && pending.current === null) setReading(false);
    })();
    setOwner({ key, generation, visit: token });
    return () => { if (visit.current === token) { visit.current = null; cancelLocalFileRead(pending.current); } };
  }, [key, generation]);
  if (!checked) return <section><h2>Responsibility preparation unavailable</h2><p>No captured responsibility worksheet is shown.</p></section>;
  const context = checked.context, state = admitted && editing?.key === key ? editing : null;
  const references = context.claims.flatMap((claim, index) => claim.evidence.map((source, i) => ({
    key: scopeReferenceKey(claim.id, i + 1), claimId: claim.id, referenceNumber: i + 1, relation: source.relation,
    label: `Proposed statement ${index + 1} · reference ${i + 1}: ${source.title} · ${source.locator} · ${source.relation}`,
    href: `#${recordedProposalReferenceAnchor("proposed", claim.id, i)}`,
  })));
  const query = admitted && filter?.key === key ? filter.query : "";
  const matches = matchingScopeReferenceKeys(context, query), matched = new Set(matches ?? []);
  function changeQuery(value: string) {
    if (!current() || key === null) return;
    const nextRevision = ++queryRevision.current;
    setFilter(old => current() && queryRevision.current === nextRevision ? { key, query: value } : old);
  }
  function update(change: (value: Editing) => Editing, structural = false, owns = ownsInput) {
    if (!owns() || key === null) return;
    cancelLocalFileRead(pending.current); if (!owns()) return; setFileState(null);
    if (structural) inputEpoch.current++;
    const nextEpoch = inputEpoch.current, nextRevision = ++revision.current;
    setEditing(old => current() && inputEpoch.current === nextEpoch && (structural || owns()) && old?.key === key
      ? { ...change(old), revision: nextRevision, preview: null, held: null } : old);
  }
  function review() {
    if (!ownsAction() || !state) return;
    cancelLocalFileRead(pending.current); if (!ownsAction()) return; setFileState(null);
    const entries = state.rows.map(row => ({ claimId: row.claimId, fields: Object.fromEntries(fieldNames.map(name => {
      const field = row.fields[name];
      return [name, !field.wording.trim() && field.references.length === 0 ? null : { wording: field.wording,
        references: field.references.map(value => { const reference = references.find(reference => reference.key === value);
          return reference ? { claimId: reference.claimId, referenceNumber: reference.referenceNumber } : null; }) }];
    })) }));
    const input = { schemaVersion: 1, kind: "responsibility_preparation", binding: context.binding, entries };
    const candidate = checkResponsibilityDraft(input, context);
    if (!ownsAction()) return;
    const bounded = candidate && responsibilityDraftJson(candidate, context) !== null ? candidate : null;
    if (!ownsAction()) return;
    const feedback = bounded ? null : responsibilityDraftFieldFeedback(input, context);
    if (!ownsAction()) return;
    const nextRevision = ++revision.current;
    setEditing(old => current() && revision.current === nextRevision && old?.key === key
      ? { ...old, revision: nextRevision, preview: bounded, held: bounded ? null : { origin: "review", fields: feedback, tooLarge: candidate !== null } } : old);
  }
  function clear() {
    if (!ownsAction() || key === null) return;
    cancelLocalFileRead(pending.current); if (!ownsAction()) return; setFileState(null);
    inputEpoch.current++; const nextRevision = ++revision.current;
    queryRevision.current++; queryInputEpoch.current++; setFilter(null);
    setEditing(old => current() && revision.current === nextRevision ? { key, revision: nextRevision, rows: [], pasted: "", preview: null, held: null } : old);
  }
  function reopen() {
    if (!ownsAction() || !state) return;
    cancelLocalFileRead(pending.current); if (!ownsAction()) return; setFileState(null);
    const candidate = reopenResponsibilityDraftJson(state.pasted, context);
    if (!ownsAction()) return;
    inputEpoch.current++; const nextRevision = ++revision.current;
    const rows = candidate ? rowsFor(candidate) : undefined;
    setEditing(old => current() && revision.current === nextRevision && old?.key === key
      ? { ...old, revision: nextRevision, rows: rows ?? old.rows, preview: candidate, held: candidate ? null : { origin: "reopen" } } : old);
  }
  function rowsFor(candidate: ResponsibilityDraft): Row[] {
    return candidate.entries.map(entry => ({ localId: ++serial.current, claimId: entry.claimId,
      fields: Object.fromEntries(fieldNames.map(name => [name, entry.fields[name] === null ? { wording: "", references: [] }
        : { wording: entry.fields[name].wording, references: entry.fields[name].references.map(reference => scopeReferenceKey(reference.claimId, reference.referenceNumber)) }])) as Fields }));
  }
  async function selectFile(file: File | undefined, malformedSelection = false) {
    if (!ownsAction() || !state || key === null) return;
    inputEpoch.current++; const readRevision = ++revision.current;
    cancelLocalFileRead(pending.current);
    const ownsRead = () => current() && revision.current === readRevision;
    if (!ownsRead()) return;
    setEditing(old => ownsRead() && old?.key === key ? { ...old, revision: readRevision, preview: null, held: null } : old);
    setFileState(null);
    if (malformedSelection) { if (ownsRead()) setFileState({ key, generation, state: "held" }); return; }
    if (!file) return;
    if (pending.current !== null || physicalResponsibilityFileReads.has(key)) { if (ownsRead()) setFileState({ key, generation, state: "busy" }); return; }
    let release = () => {};
    const settled = new Promise<void>(resolve => { release = resolve; });
    physicalResponsibilityFileReads.set(key, settled);
    setReading(true); if (ownsRead()) setFileState({ key, generation, state: "reading" });
    let controller: AbortController | null = null;
    try {
      controller = new AbortController();
      if (!ownsRead()) { cancelLocalFileRead(controller); return; }
      pending.current = controller;
      const candidate = await withLocalRequestDeadline(controller.signal, 8_000, async signal => {
        const observe = <T,>(get: () => T): T => {
          if (signal.aborted || !ownsRead()) throw Error("Responsibility file retired");
          const value = get(); if (signal.aborted || !ownsRead()) throw Error("Responsibility file retired"); return value;
        };
        const size = observe(() => file.size);
        if (!Number.isSafeInteger(size) || size < 2 || size > RESPONSIBILITY_DRAFT_BYTES) throw Error("Responsibility file refused");
        const slice = observe(() => file.slice), chunk = Reflect.apply(slice, file, [0, RESPONSIBILITY_DRAFT_BYTES + 1]) as Blob;
        if (signal.aborted || !ownsRead()) throw Error("Responsibility file retired");
        const arrayBuffer = observe(() => chunk.arrayBuffer);
        // A read already invoked before retirement keeps its physical slot
        // until real settlement; property lookup alone never dispatches it.
        const bytes = await Reflect.apply(arrayBuffer, chunk, []) as ArrayBuffer;
        if (signal.aborted || !ownsRead()) throw Error("Responsibility file retired");
        const value = readResponsibilityDraftFile(bytes, size, context);
        if (value === null) throw Error("Responsibility file refused");
        return value;
      }, undefined, () => { cancelLocalFileRead(controller); if (ownsRead()) setFileState({ key, generation, state: "held" }); });
      if (!ownsRead()) return;
      inputEpoch.current++; const nextRevision = ++revision.current, rows = rowsFor(candidate);
      setEditing(old => current() && revision.current === nextRevision && old?.key === key
        ? { ...old, revision: nextRevision, rows, pasted: "", preview: candidate, held: null } : old);
      if (current() && revision.current === nextRevision) setFileState({ key, generation, state: "loaded" });
    } catch { if (ownsRead()) setFileState({ key, generation, state: "held" }); }
    finally {
      release();
      if (physicalResponsibilityFileReads.get(key) === settled) physicalResponsibilityFileReads.delete(key);
      if (pending.current === controller) pending.current = null;
      if (visit.current !== null) setReading(pending.current !== null || (latest.current.key !== null && physicalResponsibilityFileReads.has(latest.current.key)));
    }
  }
  const preview = state?.revision === revision.current ? state.preview : null;
  const shownHeld = state?.revision === revision.current ? state.held : null;
  const feedback = shownHeld?.origin === "review" ? shownHeld.fields : null;
  const json = preview ? responsibilityDraftJson(preview, context) : null;
  const shownFile = admitted && fileState?.key === key && fileState.generation === generation ? fileState.state : null;
  return <details className="info-band"><summary>Prepare dated responsibility — unsent</summary>
    <p>This separate private worksheet does not extend the public content contract. Nothing is submitted, stored or published. Refreshing clears it; copy reviewed JSON to retain your preparation.</p>
    <p>A source publisher is not automatically the responsible authority. Record introduction, amendment, funding and delivery separately when their authorities or periods differ. A current administration does not inherit earlier actions.</p>
    <p>Keep unsupported fields blank. Preserve the source's date precision: a year is not a specific day. Entries and reference selections are unverified review material, not findings of responsibility or independent confirmation.</p>
    <p>Up to {RESPONSIBILITY_DRAFT_ENTRIES} entries, with up to 1,200 characters and 12 exact reference occurrences per supplied field. The complete copied JSON must fit {RESPONSIBILITY_DRAFT_BYTES.toLocaleString("en-US")} UTF-8 bytes.</p>
    <label htmlFor={`${prefix}-reference-search`}>Find responsibility reference choices</label>
    <input id={`${prefix}-reference-search`} type="search" maxLength={80} value={query} disabled={!admitted} onChange={event => {
      if (!current() || queryInputEpoch.current !== queryEpoch) return;
      const beforeRead = queryRevision.current, value = event.currentTarget.value;
      if (current() && queryInputEpoch.current === queryEpoch && queryRevision.current === beforeRead) changeQuery(value);
    }} />
    <button type="button" disabled={!admitted || !query} onClick={() => {
      if (current() && queryRevision.current === searchRevision) { queryInputEpoch.current++; changeQuery(""); }
    }}>Show all responsibility reference choices</button>
    <p id={`${prefix}-reference-search-status`} role="status" aria-live="polite">{matches === null ? "Reference search is invalid. Matching choices are withheld; selected choices remain." : `${matches.length} of ${references.length} recorded reference choices match.`} Search the recorded statement type, period, title, locator or relation. All words must match one occurrence. Selected choices remain visible outside the filter with their original numbers.</p>
    <button type="button" disabled={!admitted || !state || state.rows.length >= RESPONSIBILITY_DRAFT_ENTRIES} onClick={() => {
      if (!ownsAction() || !state || state.rows.length >= RESPONSIBILITY_DRAFT_ENTRIES) return;
      const row = { localId: ++serial.current, claimId: "", fields: emptyFields() };
      update(value => ({ ...value, rows: [...value.rows, row] }), true);
    }}>Add responsibility entry</button>
    {state?.rows.map((row, index) => <fieldset key={row.localId} id={`${prefix}-${row.localId}-entry`} tabIndex={-1}><legend>Responsibility entry {index + 1}</legend>
      {feedback?.entries[index]?.duplicate && <p>This duplicates an earlier complete responsibility entry. Change its documented fields or remove this entry.</p>}
      <label htmlFor={`${prefix}-${row.localId}-statement`}>Associated proposed statement</label>
      <select id={`${prefix}-${row.localId}-statement`} disabled={!admitted} value={row.claimId} aria-invalid={feedback?.entries[index]?.statement || undefined}
        aria-describedby={feedback?.entries[index]?.statement ? `${prefix}-${row.localId}-statement-error` : undefined} onChange={event => {
        const owns = preparationInputIntent(fieldIntents, epoch, `${row.localId}:statement`, ownsInput);
        if (!owns) return; const value = event.currentTarget.value;
        update(old => ({ ...old, rows: old.rows.map(item => item.localId === row.localId ? { ...item, claimId: value } : item) }), false, owns);
      }}><option value="">Choose a recorded statement</option>{context.claims.map((claim, i) => <option key={claim.id} value={claim.id}>Proposed statement {i + 1} · {statementLabels[claim.type]} · {claim.periodLabel}</option>)}</select>
      {feedback?.entries[index]?.statement && <p id={`${prefix}-${row.localId}-statement-error`}>Choose a statement from this captured proposed panel. Unknown or foreign statement choices cannot be reviewed.</p>}
      {fieldNames.map(name => {
        const hint = feedback?.entries[index]?.fields[name];
        const selected = references.filter(reference => row.fields[name].references.includes(reference.key));
        return <div key={name}>
        <label htmlFor={`${prefix}-${row.localId}-${name}-wording`}>{responsibilityFieldLabels[name]}</label>
        <textarea id={`${prefix}-${row.localId}-${name}-wording`} disabled={!admitted} maxLength={2400} value={row.fields[name].wording} aria-invalid={hint?.wording || undefined} aria-describedby={`${prefix}-limits${hint?.wording ? ` ${prefix}-${row.localId}-${name}-wording-error` : ""}`} onChange={event => {
          const owns = preparationInputIntent(fieldIntents, epoch, `${row.localId}:${name}:wording`, ownsInput);
          if (!owns) return; const value = event.currentTarget.value;
          update(old => ({ ...old, rows: old.rows.map(item => item.localId === row.localId ? { ...item, fields: { ...item.fields, [name]: { ...item.fields[name], wording: value } } } : item) }), false, owns);
        }} />
        {hint?.wording && <p id={`${prefix}-${row.localId}-${name}-wording-error`}>Supply nonblank wording of at most 1,200 characters, or clear both wording and references to leave this field unknown.</p>}
        <label htmlFor={`${prefix}-${row.localId}-${name}-references`}>References for {responsibilityFieldLabels[name]}</label>
        <select multiple id={`${prefix}-${row.localId}-${name}-references`} disabled={!admitted} value={row.fields[name].references}
          aria-invalid={hint?.references || undefined} aria-describedby={`${prefix}-limits ${prefix}-reference-search-status${hint?.references ? ` ${prefix}-${row.localId}-${name}-references-error` : ""}`} onChange={event => {
          const owns = preparationInputIntent(fieldIntents, epoch, `${row.localId}:${name}:references`, ownsInput);
          if (!owns) return; const values = Array.from(event.currentTarget.selectedOptions, option => option.value);
          update(old => ({ ...old, rows: old.rows.map(item => item.localId === row.localId ? { ...item, fields: { ...item.fields, [name]: { ...item.fields[name], references: values } } } : item) }), false, owns);
        }}>{references.filter(reference => matched.has(reference.key) || row.fields[name].references.includes(reference.key)).map(reference => <option key={reference.key} value={reference.key}>{reference.label}{!matched.has(reference.key) ? " · Selected outside this filter" : ""}</option>)}</select>
        {hint?.references && <p id={`${prefix}-${row.localId}-${name}-references-error`}>Choose one to twelve distinct reference occurrences from this proposal, or clear both wording and references to leave this field unknown.</p>}
        {selected.length > 0 && <details><summary>Inspect {selected.length} selected {selected.length === 1 ? "reference" : "references"} for {responsibilityFieldLabels[name]} in entry {index + 1}</summary>
          <p>These links locate references in their recorded proposed statements. They do not establish support for this new responsibility wording, independent confirmation or current source rights.</p>
          {selected.some(reference => reference.relation === "contradicts") && <p>A selected reference is labelled as conflicting with its recorded statement, not necessarily with this new wording.</p>}
          <ul>{selected.map(reference => <li key={reference.key}><a href={reference.href}>{reference.label}</a></li>)}</ul>
        </details>}
        {selected.length !== row.fields[name].references.length && <p>Some selections could not be located as distinct references. Review still checks every supplied selection.</p>}
      </div>; })}
      <button type="button" disabled={!admitted} onClick={() => { if (ownsAction()) update(old => ({ ...old, rows: old.rows.filter(item => item.localId !== row.localId) }), true); }}>Remove responsibility entry {index + 1}</button>
    </fieldset>)}
    <p id={`${prefix}-limits`}>Each supplied field needs wording within 1,200 characters and 1–12 distinct references. Blank fields mean unknown. Reference labels describe their original recorded statement; even a supporting label does not establish support for this new wording.</p>
    <button type="button" disabled={!admitted} onClick={review}>Review responsibility draft</button>{" "}
    <button type="button" disabled={!admitted} onClick={clear}>Clear responsibility draft</button>
    {shownHeld?.origin === "review" && <section role="status"><p>Responsibility preparation held. Check statement choices, wording, distinct references and complete JSON size. Previous preview is withheld.</p>
      {shownHeld.tooLarge && <p>The complete preparation exceeds the 16 KiB UTF-8 limit. Individual fields may be valid; shorten the complete preparation before review.</p>}
      {feedback?.tooMany && <p>Keep at most eight responsibility entries.</p>}
      {feedback && state && <ul>{feedback.entries.flatMap((entry, index) => {
        const row = state.rows[index]; if (!row) return [];
        const links = [];
        if (entry.statement) links.push(<li key={`${row.localId}-statement`}><a href={`#${prefix}-${row.localId}-statement`}>Check statement choice in entry {index + 1}</a></li>);
        if (entry.duplicate) links.push(<li key={`${row.localId}-duplicate`}><a href={`#${prefix}-${row.localId}-entry`}>Check repeated entry {index + 1}</a></li>);
        for (const name of fieldNames) for (const part of ["wording", "references"] as const) if (entry.fields[name][part])
          links.push(<li key={`${row.localId}-${name}-${part}`}><a href={`#${prefix}-${row.localId}-${name}-${part}`}>Check {responsibilityFieldLabels[name]} {part} in entry {index + 1}</a></li>);
        return links;
      })}</ul>}
    </section>}
    {shownHeld?.origin === "reopen" && <p role="status">Copied responsibility preparation could not be checked for this comparison. Previous preview is withheld.</p>}
    <details><summary>Open a saved responsibility preparation file</summary>
      <label htmlFor={`${prefix}-file`}>Choose the local responsibility preparation JSON file</label>
      <input id={`${prefix}-file`} type="file" accept=".json,application/json" disabled={!admitted || reading} onChange={event => {
        if (!ownsAction()) return;
        let file: File | undefined;
        try {
          const input = event.currentTarget; if (!ownsAction()) return;
          const files = input.files; if (!ownsAction()) return;
          file = files?.[0]; if (!ownsAction()) return;
          input.value = ""; if (!ownsAction()) return;
        } catch { if (ownsAction()) void selectFile(undefined, true); return; }
        void selectFile(file);
      }} />
      <p>Choose an exact UTF-8 copy of the reviewed JSON, up to 16 KiB, for this captured comparison. Nothing is uploaded or added to the archive; filenames are not displayed.</p>
      <div role="status" aria-live="polite" aria-busy={reading}>
        {shownFile === "reading" && <p>Checking the selected local responsibility file…</p>}
        {shownFile === "held" && <p>The responsibility file could not be checked. Previous preview is withheld; editable wording is preserved.</p>}
        {shownFile === "busy" && <p>{reading ? "A previous file read is still finishing. This selection was not read." : "The previous read has finished. Choose the file again to inspect it."}</p>}
        {shownFile === "loaded" && <p>Local responsibility preparation opened. It remains editable and unauthenticated.</p>}
      </div>
    </details>
    {preview && json !== null && <section><h3>Unsent responsibility draft</h3>
      <p>{preview.entries.length ? "Entries follow your worksheet order, not chronology or importance." : "No responsibility entries supplied. This is not evidence that no authority is responsible."}</p>
      <ol>{preview.entries.map((entry, index) => <li key={index}><p><a href={`#proposal-proposed-claim-${entry.claimId}`}>Inspect the associated proposed statement</a></p><dl>{fieldNames.map(name => <div key={name}>
        <dt>{responsibilityFieldLabels[name]}</dt><dd>{entry.fields[name] === null ? "Unknown — no wording or references supplied" : <>{entry.fields[name].wording}<ul>{entry.fields[name].references.map(reference => {
          const source = references.find(value => value.key === scopeReferenceKey(reference.claimId, reference.referenceNumber))!;
          return <li key={source.key}><a href={source.href}>{source.label}</a></li>;
        })}</ul></>}</dd>
      </div>)}</dl></li>)}</ol>
      <label htmlFor={`${prefix}-json`}>Copied responsibility preparation</label><textarea id={`${prefix}-json`} readOnly rows={12} value={json} />
    </section>}
    <label htmlFor={`${prefix}-reopen-json`}>Paste exact responsibility preparation JSON</label>
    <textarea id={`${prefix}-reopen-json`} disabled={!admitted} maxLength={RESPONSIBILITY_DRAFT_BYTES} value={state?.pasted ?? ""} onChange={event => {
      const owns = preparationInputIntent(fieldIntents, epoch, "pasted-json", ownsInput);
      if (!owns) return; const value = event.currentTarget.value;
      update(old => ({ ...old, pasted: value }), false, owns);
    }} />
    <button type="button" disabled={!admitted} onClick={reopen}>Reopen responsibility preparation</button>
  </details>;
}
