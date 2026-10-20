"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { checkedResponsibilityContext } from "./responsibility-draft.ts";
import type { ScopeDraftContext } from "./issue-scope-draft.ts";
import { preparationInputIntent, type PreparationInputIntents } from "./preparation-input-intent.ts";
import { EVALUATION_BUNDLE_BYTES } from "./evaluation-preparation-bundle.ts";
import { PLANNED_MILESTONE_DRAFT_BYTES } from "./planned-milestone-draft.ts";
import { completePreparationReading } from "./complete-preparation-reading.ts";
import { CompletePreparationReadingView } from "./complete-preparation-reading-view.tsx";

type Copies = { bundle: string; milestones: string };
type Editing = { key: string; generation: number; revision: number; copies: Copies; preview: Copies | null; held: boolean };
const empty = (): Copies => ({ bundle: "", milestones: "" });
const labels = { bundle: "Exact saved seven-part evaluation bundle JSON", milestones: "Exact separate planned-milestone JSON" } as const;

// Explicit synchronous inspection of existing copies. No File, copied carrier,
// storage, transport, automatic worksheet observation or application port.
export function CompletePreparationOrganizerView({ context: input }: { context: ScopeDraftContext | null }) {
  const checked = checkedResponsibilityContext(input), key = checked?.key ?? null, prefix = useId();
  const latest = useRef({ key, generation: 0 }), visit = useRef<object | null>(null), revision = useRef(0), inputEpoch = useRef(0);
  const intents = useRef<PreparationInputIntents>({ epoch: -1, controls: new Map() });
  const [owner, setOwner] = useState<object | null>(null), [editing, setEditing] = useState<Editing | null>(null);
  if (latest.current.key !== key) { latest.current = { key, generation: latest.current.generation + 1 }; visit.current = null; }
  const generation = latest.current.generation, epoch = inputEpoch.current, frameRevision = revision.current;
  const admitted = key !== null && owner !== null && visit.current === owner && editing?.key === key && editing.generation === generation;
  const state = admitted ? editing : null, shown = state?.revision === revision.current ? state : null;
  const current = () => admitted && visit.current === owner && latest.current.key === key && latest.current.generation === generation;
  const ownsInput = () => current() && inputEpoch.current === epoch;
  const ownsAction = () => ownsInput() && state?.revision === revision.current;
  useLayoutEffect(() => () => { visit.current = null; }, []);
  useEffect(() => {
    if (key === null) { visit.current = null; setOwner(null); setEditing(null); return; }
    const token = {}; visit.current = token; inputEpoch.current++;
    setEditing({ key, generation, revision: ++revision.current, copies: empty(), preview: null, held: false }); setOwner(token);
    return () => { if (visit.current === token) visit.current = null; };
  }, [key, generation]);
  if (!checked) return <section><h2>Preparation overview unavailable</h2><p>No copied preparation is shown.</p></section>;
  const context = checked.context;
  function edit(name: keyof Copies, event: { readonly currentTarget: HTMLTextAreaElement }) {
    const owns = preparationInputIntent(intents, epoch, name, ownsInput); if (!owns) return;
    try {
      const target = event.currentTarget; if (!owns()) return;
      const value = target.value; if (!owns()) return;
      const next = ++revision.current;
      setEditing(old => owns() && old ? { ...old, revision: next, copies: { ...old.copies, [name]: value }, preview: null, held: false } : old);
    } catch {
      if (!owns()) return;
      const next = ++revision.current;
      setEditing(old => owns() && old ? { ...old, revision: next, preview: null, held: true } : old);
    }
  }
  function inspect() {
    if (!ownsAction() || !state) return;
    const operation = ++revision.current, owns = () => current() && inputEpoch.current === epoch && revision.current === operation;
    const reading = completePreparationReading(state.copies.bundle, state.copies.milestones, context);
    if (!owns()) return;
    setEditing(old => owns() && old ? { ...old, revision: operation, preview: reading === null ? null : { ...state.copies }, held: reading === null } : old);
  }
  function clear() {
    if (!ownsInput() || frameRevision !== revision.current || key === null) return;
    inputEpoch.current++; const next = ++revision.current;
    setEditing(old => current() && old ? { ...old, revision: next, copies: empty(), preview: null, held: false } : old);
  }
  return <details className="issue-scope-preparation"><summary>Read preparations with planned milestones</summary><h2>Private preparation overview</h2>
    <p>Paste the existing seven-part bundle and a separate milestone copy explicitly. Either may be absent; at least one valid copy is needed. Supplied copies must belong to this same captured comparison. This view creates no new combined file or copied format and changes no worksheet.</p>
    <p>Missing or empty preparation is not evidence of missing action, evaluation or plans. Shared context does not match measures, establish source support or grant review, approval or publication. Keep all copies private.</p>
    <fieldset disabled={!admitted} aria-label="Private preparation overview controls">
      {(Object.keys(labels) as Array<keyof Copies>).map(name => <div key={name}><label htmlFor={`${prefix}-${name}`}>{labels[name]} — optional</label>
        <textarea id={`${prefix}-${name}`} rows={8} maxLength={name === "bundle" ? EVALUATION_BUNDLE_BYTES : PLANNED_MILESTONE_DRAFT_BYTES} value={state?.copies[name] ?? ""} disabled={!admitted} onChange={event => edit(name, event)} /></div>)}
      <button type="button" disabled={!admitted} onClick={inspect}>Inspect preparations together</button>
      <button type="button" disabled={!admitted} onClick={clear}>Clear preparation overview</button>
    </fieldset>
    <p>Each original UTF-8 limit still applies: 192 KiB for the existing bundle and 16 KiB for the separate milestone copy. The original inner preparation limits also remain. Nothing is normalized, merged, downloaded, uploaded or applied automatically.</p>
    {shown?.held && <p role="status">Preparation overview held. Check each exact copied format, its byte limit and comparison binding. No partial overview is shown; entered copies remain.</p>}
    {shown?.preview && <CompletePreparationReadingView bundleJson={shown.preview.bundle} milestoneJson={shown.preview.milestones} context={context} prefix={`${prefix}-overview`} />}
  </details>;
}
