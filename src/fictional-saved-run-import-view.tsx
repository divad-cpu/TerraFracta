"use client";

import { useEffect, useId, useRef, useState } from "react";
import { readFictionalSavedRun, SAVED_RUN_FILE_BYTE_LIMIT } from "./fictional-saved-run-import.ts";
import type { FictionalUpdateResult } from "./fictional-update-result.ts";
import { withLocalRequestDeadline } from "./local-request-deadline.ts";
import { FictionalSavedRunView } from "./fictional-saved-run-view.tsx";
import { SavedRunComparison } from "../app/editorial-preview/saved-run-comparison.tsx";

type Side = "selected" | "earlier";
type View = { state: "idle" | "reading" | "held" | "busy" } | { state: "loaded"; result: FictionalUpdateResult };
type Slot = { generation: number; pending: AbortController | null; result: FictionalUpdateResult | null };
const sides: Side[] = ["selected", "earlier"];
const labels = { selected: "Selected saved run", earlier: "Earlier run for comparison" };
const idle = (): Record<Side, View> => ({ selected: { state: "idle" }, earlier: { state: "idle" } });

// Separate from the archive desk: reopening a file cannot add a receipt or
// supply authentication, source truth, current publication or an action port.
export function FictionalSavedRunImportView() {
  const prefix = useId(), [recorded, setRecorded] = useState(idle);
  const [owner, setOwner] = useState<object | null>(null), visit = useRef<object | null>(null);
  const slots = useRef<Record<Side, Slot>>({ selected: { generation: 0, pending: null, result: null },
    earlier: { generation: 0, pending: null, result: null } });
  const [reading, setReading] = useState({ selected: false, earlier: false });
  const admitted = owner !== null && visit.current === owner;
  const generations = { selected: slots.current.selected.generation, earlier: slots.current.earlier.generation };
  const ownsView = (side: Side) => admitted && visit.current === owner && generations[side] === slots.current[side].generation;
  const views = idle();
  for (const side of sides) {
    const value = recorded[side];
    if (admitted && (value.state !== "loaded" || value.result === slots.current[side].result)) views[side] = value;
  }
  const ownsResult = (side: Side) => ownsView(side) && views[side].state === "loaded" &&
    slots.current[side].result === views[side].result && slots.current[side].pending === null;
  function clear(side: Side) {
    if (!ownsView(side)) return;
    const slot = slots.current[side]; slot.generation++; slot.result = null; slot.pending?.abort();
    setRecorded(old => ({ ...old, [side]: { state: "idle" } }));
  }
  async function select(side: Side, file: File | undefined) {
    if (!ownsView(side)) return;
    if (!file) { clear(side); return; }
    const slot = slots.current[side]; slot.generation++; slot.result = null;
    if (slot.pending) {
      slot.pending.abort(); setRecorded(old => ({ ...old, [side]: { state: "busy" } })); return;
    }
    const generation = slot.generation, controller = new AbortController(); slot.pending = controller;
    const current = () => visit.current === owner && generation === slot.generation;
    setReading(old => ({ ...old, [side]: true })); setRecorded(old => ({ ...old, [side]: { state: "reading" } }));
    try {
      const result = await withLocalRequestDeadline(controller.signal, 8_000, async signal => {
        const size = file.size;
        if (!Number.isSafeInteger(size) || size < 2 || size > SAVED_RUN_FILE_BYTE_LIMIT) throw new Error("Saved file size refused");
        const bytes = await file.slice(0, SAVED_RUN_FILE_BYTE_LIMIT + 1).arrayBuffer();
        if (signal.aborted || !current()) throw new Error("Saved file read retired");
        return readFictionalSavedRun(bytes, size);
      }, undefined, () => {
        controller.abort();
        if (current()) setRecorded(old => ({ ...old, [side]: { state: "held" } }));
      });
      if (current()) { slot.result = result; setRecorded(old => ({ ...old, [side]: { state: "loaded", result } })); }
    } catch {
      if (current()) setRecorded(old => ({ ...old, [side]: { state: "held" } }));
    } finally {
      if (slot.pending === controller) {
        slot.pending = null;
        if (visit.current !== null) setReading(old => ({ ...old, [side]: false }));
      }
    }
  }
  useEffect(() => {
    const current = {}; visit.current = current; setOwner(current);
    for (const side of sides) { slots.current[side].generation++; slots.current[side].result = null; }
    setRecorded(idle()); setReading({ selected: slots.current.selected.pending !== null, earlier: slots.current.earlier.pending !== null });
    return () => {
      if (visit.current !== current) return;
      visit.current = null;
      for (const side of sides) { const slot = slots.current[side]; slot.generation++; slot.result = null; slot.pending?.abort(); }
    };
  }, []);
  return <section className="completion-results" aria-labelledby={`${prefix}-heading`}>
    <h2 id={`${prefix}-heading`}>Reopen downloaded fictional runs</h2>
    <p>Choose files previously downloaded with “Download saved run”, up to 128 KiB each. They stay in memory in this browser; nothing is uploaded or added to the archive. Filenames are not displayed.</p>
    <p className="info-band">A local file is editable, unauthenticated historical material. Passing the format checks does not prove that a run occurred or qualify its sources, decisions or publication.</p>
    {sides.map(side => <section key={side} aria-labelledby={`${prefix}-${side}-heading`}>
      <h3 id={`${prefix}-${side}-heading`}>{labels[side]}</h3>
      <label htmlFor={`${prefix}-${side}-file`}>Choose {side === "selected" ? "the run to inspect" : "an optional earlier run"}</label>
      <input id={`${prefix}-${side}-file`} type="file" accept=".json,application/json" disabled={!admitted || reading[side]} onChange={event => {
        if (!ownsView(side)) return;
        const input = event.currentTarget, file = input.files?.[0]; input.value = ""; void select(side, file);
      }} />
      <button type="button" className="button button--quiet" disabled={!admitted} onClick={() => clear(side)}>Clear {side === "selected" ? "selected file" : "earlier file"}</button>
      <div role="status" aria-live="polite" aria-busy={reading[side]}>
        {views[side].state === "idle" && <p>No {side === "selected" ? "selected" : "earlier"} file is open.</p>}
        {views[side].state === "reading" && <p>Checking the selected local file…</p>}
        {views[side].state === "held" && <p>The file could not be read as a bounded fictional saved run. Previous contents and actions are withheld.</p>}
        {views[side].state === "busy" && <p>{reading[side] ? "A previous file read is still finishing. This file was not read." : "The previous read has finished. Choose the file again to inspect it."}</p>}
        {reading[side] && views[side].state !== "reading" && <p>The previous read still owns its slot. Clearing or cancellation does not start another read.</p>}
      </div>
      {views[side].state === "loaded" && <details open={side === "selected"}>
        <summary>Inspect {side === "selected" ? "the selected" : "the earlier"} historical file</summary>
        <FictionalSavedRunView key={`${side}:${generations[side]}`} input={views[side].result} isCurrent={() => ownsResult(side)} />
      </details>}
    </section>)}
    {views.selected.state === "loaded" && views.earlier.state === "loaded" && <SavedRunComparison
      key={`${generations.earlier}:${generations.selected}`} earlier={views.earlier.result} later={views.selected.result}
      isCurrent={() => ownsResult("earlier") && ownsResult("selected")} />}
  </section>;
}
