"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { checkedScopeDraftContext, checkScopeDraft, scopeDraftJson, reopenScopeDraftJson, scopeDraftFieldFeedback, SCOPE_DRAFT_BYTES, scopeFieldLabels, scopeReferenceKey,
  type ScopeDraftCandidate, type ScopeDraftContext, type ScopeField, type ScopeDraftFieldFeedback } from "./issue-scope-draft.ts";
import { readScopeDraftFile } from "./issue-scope-file.ts";
import { withLocalRequestDeadline } from "./local-request-deadline.ts";
import { cancelLocalFileRead } from "./local-file-cancellation.ts";
import { recordedProposalReferenceAnchor } from "./recorded-reference-differences.ts";
import { matchingScopeReferenceKeys } from "./issue-scope-reference-search.ts";
import { statementLabels } from "./issue-display-labels.ts";
import { observeClientError } from "./client-error-diagnostics.ts";
import { preparationInputIntent, type PreparationInputIntents } from "./preparation-input-intent.ts";

type Fields = Record<ScopeField, { wording: string; references: string[] }>;
type Held = { key: string; revision: number } & (
  { origin: "review"; fields: ScopeDraftFieldFeedback | null; tooLarge: boolean } | { origin: "reopen" });
const empty = (): Fields => ({ population: { wording: "", references: [] }, period: { wording: "", references: [] }, selectionRationale: { wording: "", references: [] } });
type ScopeFileSlot = { released: boolean; waiters: Array<() => void> };
const physicalScopeFileReads = new Map<string, ScopeFileSlot>();
function waitForScopeFileSlot(slot: ScopeFileSlot): Promise<void> {
  return new Promise(resolve => { if (slot.released) resolve(); else slot.waiters.push(resolve); });
}

// In-memory preparation for one captured proposal. File inspection is local
// and bounded, with no upload/storage/editorial-action port. Old render handlers
// retire before a replacement effect; physical file reads retain their slot.
export function IssueScopeDraftView({ context: input }: { context: ScopeDraftContext }) {
  const checked = checkedScopeDraftContext(input), key = checked?.key ?? null;
  const prefix = useId(), latest = useRef({ key, generation: 0 });
  const visit = useRef<object | null>(null), contentRevision = useRef(0);
  const fieldRevision = useRef(0);
  const inputEpoch = useRef(0), epoch = inputEpoch.current;
  const fieldIntents = useRef<PreparationInputIntents>({ epoch: -1, controls: new Map() });
  const filterRevision = useRef(0), searchRevision = filterRevision.current;
  const referenceInputEpoch = useRef(0), referenceEpoch = referenceInputEpoch.current;
  const revision = contentRevision.current, pending = useRef<AbortController | null>(null);
  if (latest.current.key !== key) { latest.current = { key, generation: latest.current.generation + 1 }; visit.current = null; }
  const generation = latest.current.generation;
  const [owner, setOwner] = useState<{ visit: object; key: string; generation: number } | null>(null);
  const [editing, setEditing] = useState<{ key: string; fields: Fields; revision: number } | null>(null);
  const [preview, setPreview] = useState<{ key: string; candidate: ScopeDraftCandidate } | null>(null);
  const [pasted, setPasted] = useState<{ key: string; json: string } | null>(null);
  const [reading, setReading] = useState(false);
  const [fileState, setFileState] = useState<{ key: string; state: "reading" | "held" | "busy" | "loaded" } | null>(null);
  const [filter, setFilter] = useState<{ key: string; query: string } | null>(null);
  const [held, setHeld] = useState<Held | null>(null);
  const [exportNotice, setExportNotice] = useState<{ key: string; revision: number; text: string } | null>(null);
  const admitted = key !== null && owner?.key === key && owner.generation === generation && visit.current === owner.visit;
  const current = () => admitted && latest.current.key === key && latest.current.generation === generation && visit.current === owner?.visit;
  const ownsAction = () => current() && contentRevision.current === revision;
  const ownsInput = () => current() && inputEpoch.current === epoch;
  const fields = admitted && key !== null && editing?.key === key ? editing.fields : empty();
  const fieldsRepresented = (editing?.key === key ? editing.revision : 0) === fieldRevision.current;
  // Retire at committed unmount, before deferred passive cleanup can run.
  useLayoutEffect(() => () => { visit.current = null; cancelLocalFileRead(pending.current); }, []);
  useEffect(() => {
    if (key === null) { visit.current = null; setOwner(null); return; }
    const token = {}; visit.current = token; setOwner({ visit: token, key, generation });
    contentRevision.current++; inputEpoch.current++; filterRevision.current++; referenceInputEpoch.current++; setFilter(null);
    fieldRevision.current = 0; setEditing(null); setPreview(null); setPasted(null); setHeld(null); setFileState(null);
    const occupied = physicalScopeFileReads.has(key);
    setReading(pending.current !== null || occupied);
    if (occupied && pending.current === null) void (async () => {
      let slot: ScopeFileSlot | undefined;
      while ((slot = physicalScopeFileReads.get(key))) await waitForScopeFileSlot(slot);
      if (visit.current === token && pending.current === null) setReading(false);
    })();
    return () => { if (visit.current === token) { visit.current = null; cancelLocalFileRead(pending.current); } };
  }, [key, generation]);
  if (checked === null) return <section><h2>Issue scope preparation unavailable</h2><p>No captured scope or editable draft is shown.</p></section>;
  const context = checked.context;
  const references = context.claims.flatMap((claim, index) => claim.evidence.map((source, referenceIndex) => ({
    key: scopeReferenceKey(claim.id, referenceIndex + 1), claimId: claim.id, referenceNumber: referenceIndex + 1,
    relation: source.relation,
    label: `Proposed statement ${index + 1}: ${statementLabels[claim.type]} · ${claim.periodLabel} · reference ${referenceIndex + 1}: ${source.title} · ${source.locator} · ${source.relation}`,
    href: `#${recordedProposalReferenceAnchor("proposed", claim.id, referenceIndex)}`,
  })));
  const query = admitted && filter?.key === key ? filter.query : "";
  const matchingKeys = matchingScopeReferenceKeys(context, query);
  const matched = new Set(matchingKeys ?? []);
  function changeFilter(value: string) {
    if (!current() || key === null) return;
    const ownRevision = ++filterRevision.current;
    setFilter(old => current() && filterRevision.current === ownRevision ? { key, query: value } : old);
  }
  function edit(field: ScopeField, change: Partial<Fields[ScopeField]>, owns = ownsInput) {
    if (!owns() || key === null) return;
    contentRevision.current++; cancelLocalFileRead(pending.current);
    if (!owns()) return;
    const editedRevision = ++fieldRevision.current;
    setPreview(null); setHeld(null); setFileState(null);
    setEditing(old => owns() ? { key, revision: editedRevision, fields: { ...(old?.key === key ? old.fields : empty()),
      [field]: { ...(old?.key === key ? old.fields[field] : empty()[field]), ...change } } } : old);
  }
  function review() {
    if (!ownsAction() || !fieldsRepresented || key === null) return;
    const operation = ++contentRevision.current, owns = () => current() && inputEpoch.current === epoch && contentRevision.current === operation;
    cancelLocalFileRead(pending.current); if (!owns()) return; setFileState(null);
    const draftFields = Object.fromEntries((Object.keys(scopeFieldLabels) as ScopeField[]).map(field => {
      const value = fields[field];
      if (!value.wording.trim() && value.references.length === 0) return [field, null];
      return [field, { wording: value.wording, references: value.references.map(value => {
        const reference = references.find(reference => reference.key === value);
        return reference ? { claimId: reference.claimId, referenceNumber: reference.referenceNumber } : null;
      }) }];
    }));
    const candidate = checkScopeDraft({ schemaVersion: 1, kind: "issue_scope_preparation", binding: context.binding, fields: draftFields }, context);
    if (!owns()) return;
    const bounded = candidate && scopeDraftJson(candidate, context) !== null ? candidate : null;
    if (!owns()) return;
    const feedback = bounded ? null : scopeDraftFieldFeedback(draftFields, context);
    if (!owns()) return;
    setPreview(bounded ? { key, candidate: bounded } : null);
    setHeld(bounded ? null : { key, revision: operation, origin: "review",
      fields: feedback, tooLarge: candidate !== null });
  }
  function reopen() {
    if (!ownsAction() || key === null) return;
    const operation = ++contentRevision.current, owns = () => current() && inputEpoch.current === epoch && contentRevision.current === operation;
    cancelLocalFileRead(pending.current); if (!owns()) return; setFileState(null);
    const candidate = reopenScopeDraftJson(pasted?.key === key ? pasted.json : "", context);
    if (!owns()) return;
    setPreview(candidate ? { key, candidate } : null);
    setHeld(candidate ? null : { key, revision: operation, origin: "reopen" });
    if (candidate) install(candidate);
  }
  function install(candidate: ScopeDraftCandidate) {
    if (key === null) return;
    contentRevision.current++; inputEpoch.current++;
    setEditing({ key, revision: ++fieldRevision.current, fields: Object.fromEntries((Object.keys(scopeFieldLabels) as ScopeField[]).map(field => {
      const value = candidate.fields[field];
      return [field, value === null ? { wording: "", references: [] } : { wording: value.wording,
        references: value.references.map(reference => scopeReferenceKey(reference.claimId, reference.referenceNumber)) }];
    })) as Fields });
  }
  function clear() {
    if (!ownsAction()) return;
    const operation = ++contentRevision.current; inputEpoch.current++; cancelLocalFileRead(pending.current);
    if (!current() || contentRevision.current !== operation) return;
    fieldRevision.current = 0; setEditing(null); setPreview(null); setPasted(null); setHeld(null); setFileState(null);
  }
  async function selectFile(file: File | undefined, malformedSelection = false) {
    if (!ownsAction() || key === null) return;
    const readRevision = ++contentRevision.current; inputEpoch.current++;
    const ownsRead = () => current() && contentRevision.current === readRevision;
    cancelLocalFileRead(pending.current); if (!ownsRead()) return;
    if (malformedSelection) { setPreview(null); setHeld(null); setFileState({ key, state: "held" }); return; }
    fieldRevision.current = 0; setEditing(null); setPreview(null); setPasted(null); setHeld(null); setFileState(null);
    if (!file) return;
    if (pending.current !== null || physicalScopeFileReads.has(key)) { setFileState({ key, state: "busy" }); return; }
    // Reserve before controller, timer or File observations. A fresh same-key
    // visit must see the slot even if setup synchronously reenters this view.
    const slot: ScopeFileSlot = { released: false, waiters: [] }; physicalScopeFileReads.set(key, slot);
    let controller: AbortController | null = null;
    try {
      controller = new AbortController();
      if (!ownsRead()) { cancelLocalFileRead(controller); return; }
      pending.current = controller;
      setReading(true); setFileState({ key, state: "reading" });
      const candidate = await withLocalRequestDeadline(controller.signal, 8_000, async signal => {
        const observe = <T,>(get: () => T): T => {
          if (signal.aborted || !ownsRead()) throw Error("Scope file retired");
          const value = get(); if (signal.aborted || !ownsRead()) throw Error("Scope file retired"); return value;
        };
        const size = observe(() => file.size);
        if (!Number.isSafeInteger(size) || size < 2 || size > SCOPE_DRAFT_BYTES) throw Error("Scope file refused");
        const slice = observe(() => file.slice), chunk = Reflect.apply(slice, file, [0, SCOPE_DRAFT_BYTES + 1]) as Blob;
        if (signal.aborted || !ownsRead()) throw Error("Scope file retired");
        const arrayBuffer = observe(() => chunk.arrayBuffer);
        // An invoked native read owns its physical slot until real settlement,
        // including retirement inside the method call itself.
        const bytes = await Reflect.apply(arrayBuffer, chunk, []) as ArrayBuffer;
        if (signal.aborted || !ownsRead()) throw Error("Scope file retired");
        const candidate = readScopeDraftFile(bytes, size, context);
        if (signal.aborted || !ownsRead()) throw Error("Scope file retired");
        if (candidate === null) throw Error("Scope file refused");
        return candidate;
      }, undefined, () => { cancelLocalFileRead(controller); if (ownsRead()) setFileState({ key, state: "held" }); });
      if (ownsRead()) { install(candidate); setPreview({ key, candidate }); setFileState({ key, state: "loaded" }); }
    } catch { if (ownsRead()) setFileState({ key, state: "held" }); }
    finally {
      if (physicalScopeFileReads.get(key) === slot) physicalScopeFileReads.delete(key);
      slot.released = true; for (const release of slot.waiters.splice(0)) release();
      if (controller !== null && pending.current === controller) { pending.current = null; if (visit.current !== null) setReading(false); }
    }
  }

  const shown = admitted && preview?.key === key ? preview.candidate : null;
  const shownHeld = admitted && held?.key === key && held.revision === revision ? held : null;
  const feedback = shownHeld?.origin === "review" ? shownHeld.fields : null;
  function download() {
    if (!ownsAction() || shown === null || key === null) return;
    let url: string | null = null, link: HTMLAnchorElement | null = null;
    try {
      const json = scopeDraftJson(shown, context);
      if (json === null || !ownsAction()) return;
      link = document.createElement("a");
      if (!ownsAction()) return;
      const blob = new Blob([json], { type: "application/json" });
      if (!ownsAction()) return;
      url = URL.createObjectURL(blob);
      if (!ownsAction()) return;
      link.href = url; link.download = "terrafracta-scope-preparation.json";
      if (!ownsAction()) return;
      document.body.append(link);
      if (!ownsAction()) return;
      link.click();
      if (ownsAction()) setExportNotice({ key, revision, text: "Download requested. Keep the local file private. It contains editable preparation and recorded references, not an authentic review or publication." });
    } catch {
      if (ownsAction()) {
        observeClientError("scope_draft_export");
        setExportNotice({ key, revision, text: "The preparation could not be downloaded. Its displayed wording and references are preserved." });
      }
    } finally {
      try { link?.remove(); } catch { /* Keep the original request/refusal outcome. */ }
      if (url !== null) try { URL.revokeObjectURL(url); } catch { /* No retry or recursive diagnostic. */ }
    }
  }
  return <details className="issue-scope-preparation"><summary>Prepare missing dossier scope — unsent</summary>
    <h2 id={`${prefix}-heading`}>Issue scope preparation</h2>
    <p>Population, dossier period and selection rationale are not supplied by the captured publication contract. Leave unknown fields blank. A statement's data period or denominator does not automatically define the whole dossier.</p>
    <p>This draft stays in memory while this view is open. Nothing is submitted, saved to the archive or published. Copied or downloaded JSON is editable, unauthenticated preparation; it is not a review receipt or an extension of the public snapshot.</p>
    <p>Use only this proposal's exact reference occurrences. They remain unverified: a supporting label does not establish that a source supports the new wording, and repeated references do not establish independence. Selection needs consideration of scale, severity, development, public concern and local relevance; official announcements alone are insufficient.</p>
    <label htmlFor={`${prefix}-reference-search`}>Find recorded reference choices</label>
    <input id={`${prefix}-reference-search`} type="search" maxLength={80} value={query} disabled={!admitted} onChange={event => {
      if (!current() || referenceInputEpoch.current !== referenceEpoch) return;
      const beforeRead = filterRevision.current, value = event.currentTarget.value;
      if (current() && referenceInputEpoch.current === referenceEpoch && filterRevision.current === beforeRead) changeFilter(value);
    }} />
    <button type="button" disabled={!admitted || !query} onClick={() => { if (current() && filterRevision.current === searchRevision) { referenceInputEpoch.current++; changeFilter(""); } }}>Show all reference choices</button>
    <p id={`${prefix}-reference-search-status`} role="status" aria-live="polite">{matchingKeys === null ? "Reference search is invalid. Matching choices are withheld; existing selections remain." : `${matchingKeys.length} of ${references.length} recorded reference choices match.`} Search the displayed statement type, period, title, locator or relation. All words must match one occurrence. Selected choices remain visible outside the filter, with their original numbers.</p>
    {(Object.keys(scopeFieldLabels) as ScopeField[]).map(field => {
      const selected = references.filter(reference => fields[field].references.includes(reference.key));
      return <section key={field} aria-labelledby={`${prefix}-${field}-heading`}>
      <h3 id={`${prefix}-${field}-heading`}>{scopeFieldLabels[field]}</h3>
      <label htmlFor={`${prefix}-${field}-wording`}>Proposed wording (optional)</label>
      {/* Native maxLength counts UTF-16 units; the pinned schema counts Unicode
          code points. Leave room for two units per point; review remains 1,200. */}
      <textarea id={`${prefix}-${field}-wording`} maxLength={2 * 1200} value={fields[field].wording} aria-invalid={feedback?.[field].wording || undefined}
        aria-describedby={`${prefix}-${field}-guidance${feedback?.[field].wording ? ` ${prefix}-${field}-wording-error` : ""}`}
        disabled={!admitted} onChange={event => {
          const owns = preparationInputIntent(fieldIntents, epoch, `${field}:wording`, ownsInput);
          if (owns) edit(field, { wording: event.currentTarget.value }, owns);
        }} />
      {feedback?.[field].wording && <p id={`${prefix}-${field}-wording-error`}>Supply nonblank wording of at most 1,200 characters, or clear both wording and references to leave this field unknown.</p>}
      <label htmlFor={`${prefix}-${field}-references`}>Recorded references to inspect for this wording</label>
      <select id={`${prefix}-${field}-references`} multiple size={4} value={fields[field].references} aria-invalid={feedback?.[field].references || undefined}
        aria-describedby={`${prefix}-reference-search-status ${prefix}-${field}-guidance${feedback?.[field].references ? ` ${prefix}-${field}-references-error` : ""}`}
        disabled={!admitted} onChange={event => {
          const owns = preparationInputIntent(fieldIntents, epoch, `${field}:references`, ownsInput);
          if (owns) edit(field, { references: Array.from(event.currentTarget.selectedOptions, option => option.value) }, owns);
        }}>
        {references.filter(reference => matched.has(reference.key) || fields[field].references.includes(reference.key)).map(reference => <option key={reference.key} value={reference.key}>{reference.label}{!matched.has(reference.key) ? " · Selected outside this filter" : ""}</option>)}
      </select>
      {feedback?.[field].references && <p id={`${prefix}-${field}-references-error`}>Choose one to twelve distinct reference occurrences from this proposal, or clear both wording and references to leave this field unknown.</p>}
      <p id={`${prefix}-${field}-guidance`}>Supplied wording is checked at review: at most 1,200 characters after trimming. Choose at least one and at most twelve reference occurrences for supplied wording. Unknown fields have neither wording nor references.</p>
      {selected.length > 0 && <details>
        <summary>Inspect {selected.length} selected {selected.length === 1 ? "reference" : "references"} for {scopeFieldLabels[field]}</summary>
        <p>These links locate exact references in their recorded proposed statements. They do not establish support for your new wording, independent confirmation or current source rights. Review still checks the complete draft.</p>
        {selected.some(reference => reference.relation === "contradicts") && <p role="note">A selected reference is labelled as conflicting with its recorded statement. This does not identify a contradiction in your new wording.</p>}
        <ul>{selected.map(reference => <li key={reference.key}><a href={reference.href}>{reference.label}</a></li>)}</ul>
      </details>}
      {fields[field].references.length !== selected.length && <p role="note">Some selections could not be located as distinct references in this proposal. Review still checks all supplied selections.</p>}
    </section>; })}
    <details><summary>Open a saved preparation file</summary>
      <label htmlFor={`${prefix}-file`}>Choose the local preparation JSON file</label>
      <input id={`${prefix}-file`} type="file" accept=".json,application/json" disabled={!admitted || reading} onChange={event => {
        if (!ownsAction()) return;
        try {
          const input = event.currentTarget; if (!ownsAction()) return;
          const files = input.files; if (!ownsAction()) return;
          const file = files?.[0]; if (!ownsAction()) return;
          input.value = ""; if (!ownsAction()) return;
          void selectFile(file);
        } catch { void selectFile(undefined, true); }
      }} />
      <p>The file stays in memory here; nothing is uploaded or added to the archive. Filenames are not displayed. Up to 16 KiB of exact UTF-8 preparation JSON, bound to this captured comparison.</p>
      <div role="status" aria-live="polite" aria-busy={reading}>
        {admitted && fileState?.key === key && fileState.state === "reading" && <p>Checking the selected local preparation file…</p>}
        {admitted && fileState?.key === key && fileState.state === "held" && <p>The file could not be checked for this captured comparison. Previous preview is withheld.</p>}
        {admitted && fileState?.key === key && fileState.state === "busy" && <p>{reading ? "A previous file read is still finishing. This selection was not read." : "The previous read has finished. Choose the file again to inspect it."}</p>}
        {admitted && fileState?.key === key && fileState.state === "loaded" && <p>Local preparation file opened. It remains editable and unauthenticated; no review or publication is established.</p>}
        {reading && fileState?.state !== "reading" && <p>The previous file read still owns its slot. Cancellation does not start another read.</p>}
      </div>
    </details>
    <details><summary>Reopen copied preparation JSON</summary>
      <label htmlFor={`${prefix}-reopen-json`}>Paste the exact preparation JSON</label>
      <textarea id={`${prefix}-reopen-json`} maxLength={SCOPE_DRAFT_BYTES} value={admitted && pasted?.key === key ? pasted.json : ""} disabled={!admitted} onChange={event => {
        const owns = preparationInputIntent(fieldIntents, epoch, "pasted-json", ownsInput);
        if (!owns || key === null) return;
        const json = event.currentTarget.value; if (!owns()) return;
        contentRevision.current++; cancelLocalFileRead(pending.current); if (!owns()) return;
        setFileState(null); setPasted({ key, json }); setPreview(null); setHeld(null);
      }} />
      <p>Up to 16 KiB of UTF-8, in the exact exported format. The capture, proposal and comparison evidence must still match. Editable JSON does not prove a review occurred.</p>
      <button type="button" disabled={!admitted} onClick={reopen}>Reopen scope preparation</button>
    </details>
    <button type="button" disabled={!admitted || !fieldsRepresented} onClick={review}>Review scope draft</button>
    <button type="button" disabled={!admitted} onClick={clear}>Clear scope draft</button>
    <div role="status" aria-live="polite">{shownHeld && <>
      <p>{shownHeld.origin === "review" && shownHeld.tooLarge
        ? "The complete preparation exceeds the 16 KiB UTF-8 export limit. Shorten wording or reduce reference selections before reviewing again. Previous preview is withheld."
        : "The draft needs bounded wording and valid unique references, or matching preparation JSON in the exported format. Previous preview is withheld."}</p>
      {feedback && Object.values(feedback).some(field => field.wording || field.references) && <ul>{(Object.keys(scopeFieldLabels) as ScopeField[]).flatMap(field => [
        feedback[field].wording ? <li key={`${field}-wording`}><a href={`#${prefix}-${field}-wording`}>{scopeFieldLabels[field]}: check wording</a></li> : null,
        feedback[field].references ? <li key={`${field}-references`}><a href={`#${prefix}-${field}-references`}>{scopeFieldLabels[field]}: check references</a></li> : null,
      ])}</ul>}
    </>}</div>
    {shown && <section aria-labelledby={`${prefix}-preview-heading`}><h3 id={`${prefix}-preview-heading`}>Unsent scope draft</h3>
      <p>Capture reference: <code>{shown.binding.captureId}</code>. The binding identifies recorded material, not current eligibility or authentic review.</p>
      <dl>{(Object.keys(scopeFieldLabels) as ScopeField[]).map(field => <div key={field}><dt>{scopeFieldLabels[field]}</dt><dd>{shown.fields[field] === null ? "Unknown — no wording or references supplied" : <>
        <p>{shown.fields[field].wording}</p><ul>{shown.fields[field].references.map(reference => {
          const row = references.find(row => row.claimId === reference.claimId && row.referenceNumber === reference.referenceNumber)!;
          return <li key={row.key}><a href={row.href}>{row.label}</a></li>;
        })}</ul>
      </>}</dd></div>)}</dl>
      <label htmlFor={`${prefix}-json`}>Preparation JSON (copy manually; not a publication payload)</label>
      <textarea id={`${prefix}-json`} readOnly rows={12} value={scopeDraftJson(shown, context) ?? ""} />
      <button type="button" onClick={download}>Download scope preparation</button>
      <p>This explicitly creates a local file wherever your browser saves downloads. No file is uploaded or stored in the archive. Clearing or closing this view does not remove downloaded copies; keep them private. Reopening still requires the exact captured comparison.</p>
      {exportNotice?.key === key && exportNotice.revision === revision && <p role="status">{exportNotice.text}</p>}
      <p>Each supplied field still needs factual, language and source-rights review. Unknown fields remain gaps. No approval, current head check, capture update or publication action is available.</p>
    </section>}
  </details>;
}
