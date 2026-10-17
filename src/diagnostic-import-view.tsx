"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { diagnosticCodes } from "./error-diagnostics.ts";
import { diagnosticSelection, selectDiagnosticEvents, type DiagnosticReport, type DiagnosticSelection } from "./diagnostic-report.ts";
import { readDiagnosticExport, DIAGNOSTIC_IMPORT_BYTES } from "./diagnostic-import.ts";
import { DiagnosticRecords } from "./diagnostic-records-view.tsx";
import { withLocalRequestDeadline } from "./local-request-deadline.ts";
import { cancelLocalFileRead } from "./local-file-cancellation.ts";

type View = { state: "idle" | "reading" | "held" | "busy" } | { state: "loaded"; report: DiagnosticReport };
const empty: DiagnosticSelection = { code: "", origin: "", reference: "", page: 1 };
const physicalDiagnosticFileRead: { current: Promise<void> | null } = { current: null };
export function DiagnosticImportView() {
  const prefix = useId(), id = (part: string) => `${prefix}-${part}`;
  const [recordedView, setView] = useState<View>({ state: "idle" }), [reading, setReading] = useState(false);
  const [selection, setSelection] = useState(empty), [reference, setReference] = useState("");
  const [invalidReference, setInvalidReference] = useState(false);
  const visit = useRef<object | null>(null), generation = useRef(0), pending = useRef<AbortController | null>(null);
  const observation = useRef<DiagnosticReport | null>(null), [owner, setOwner] = useState<object | null>(null);
  const admitted = owner !== null && visit.current === owner, renderedGeneration = generation.current;
  const view: View = admitted && (recordedView.state !== "loaded" || observation.current === recordedView.report)
    ? recordedView : { state: "idle" };
  const ownsView = () => admitted && visit.current === owner && renderedGeneration === generation.current;
  // A report's controls belong to that exact visit and file observation.
  const ownsReport = () => ownsView() && view.state === "loaded" && observation.current === view.report && pending.current === null;
  function clear() {
    if (!ownsView()) return;
    generation.current++; observation.current = null; cancelLocalFileRead(pending.current); setView({ state: "idle" });
    setSelection(empty); setReference(""); setInvalidReference(false);
  }
  async function select(file: File | undefined) {
    if (!ownsView()) return;
    if (!file) { clear(); return; }
    generation.current++; observation.current = null;
    setSelection(empty); setReference(""); setInvalidReference(false);
    if (pending.current || physicalDiagnosticFileRead.current) { cancelLocalFileRead(pending.current); setView({ state: "busy" }); return; }
    const current = generation.current;
    let controller: AbortController;
    try { controller = new AbortController(); }
    catch { if (visit.current === owner && current === generation.current) setView({ state: "held" }); return; }
    pending.current = controller;
    setReading(true); setView({ state: "reading" });
    let settled: Promise<void> | null = null;
    let releaseOwnedRead = () => {};
    try {
      settled = new Promise<void>(resolve => { releaseOwnedRead = resolve; });
      physicalDiagnosticFileRead.current = settled;
      const read = withLocalRequestDeadline(controller.signal, 8_000, async () => {
        const size = file.size;
        if (!Number.isSafeInteger(size) || size < 2 || size > DIAGNOSTIC_IMPORT_BYTES) throw new Error("Diagnostic export size refused");
        const bytes = await file.slice(0, DIAGNOSTIC_IMPORT_BYTES + 1).arrayBuffer();
        if (controller.signal.aborted) throw new Error("Diagnostic export unavailable");
        return readDiagnosticExport(bytes, size);
      }, undefined, () => {
        cancelLocalFileRead(controller);
        if (visit.current === owner && current === generation.current) setView({ state: "held" });
      });
      const report = await read;
      if (visit.current === owner && current === generation.current) { observation.current = report; setView({ state: "loaded", report }); }
    } catch {
      if (visit.current === owner && current === generation.current) setView({ state: "held" });
    } finally {
      releaseOwnedRead();
      if (settled !== null && physicalDiagnosticFileRead.current === settled) physicalDiagnosticFileRead.current = null;
      if (pending.current === controller) {
        pending.current = null;
        if (visit.current !== null) setReading(false);
      }
    }
  }
  function findReference(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ownsReport()) return;
    const next = diagnosticSelection({ code: selection.code, origin: selection.origin, ref: reference });
    setInvalidReference(!next); if (next) setSelection(next);
  }
  // Retire local file access and callbacks during committed unmount.
  useLayoutEffect(() => () => { visit.current = null; observation.current = null; generation.current++; cancelLocalFileRead(pending.current); }, []);
  useEffect(() => {
    const current = {};
    visit.current = current; setOwner(current); observation.current = null;
    setView({ state: "idle" }); setSelection(empty); setReference(""); setInvalidReference(false);
    const occupied = physicalDiagnosticFileRead.current !== null;
    setReading(pending.current !== null || occupied);
    if (occupied && pending.current === null) void (async () => {
      while (physicalDiagnosticFileRead.current) await physicalDiagnosticFileRead.current;
      if (visit.current === current && pending.current === null) setReading(false);
    })();
    return () => {
      if (visit.current !== current) return;
      visit.current = null; observation.current = null; generation.current++; cancelLocalFileRead(pending.current);
    };
  }, []);
  const selected = view.state === "loaded" ? selectDiagnosticEvents(view.report, selection) : null;
  return <section className="diagnostic-saved" aria-labelledby={id("heading")}>
    <div className="section-heading"><h2 id={id("heading")}>Open a saved private error export</h2><span className="tag tag--caution">Historical report</span></div>
    <p>Choose an exported JSON file, up to 768 KiB. Its contents are read in this browser and held in memory. Nothing is uploaded, saved to the archive or sent for repair. Filenames are not displayed.</p>
    <label htmlFor={id("file")}>Choose a local diagnostic export</label>
    <input id={id("file")} type="file" accept=".json,application/json" disabled={!admitted || reading} onChange={event => {
      if (!ownsView()) return;
      const input = event.currentTarget, file = input.files?.[0]; input.value = ""; void select(file);
    }} />
    <div role="status" aria-live="polite" aria-busy={reading}>
      {view.state === "idle" && <p>No saved error export is selected.</p>}
      {view.state === "reading" && <p>Checking the selected diagnostic export…</p>}
      {view.state === "held" && <p>The selected file could not be read as a bounded diagnostic export. Previous contents are withheld.</p>}
      {view.state === "busy" && <p>{reading
        ? "A previous file read is still finishing. This selection was not read; choose it again after that read settles."
        : "The previous read has finished. This selection was not read; choose the file again to inspect it."}</p>}
      {reading && view.state !== "reading" && <p>The previous read still owns its slot. Clearing or cancellation does not start another read.</p>}
    </div>
    {view.state === "loaded" && selected && <>
      <p>Export observation: <time dateTime={view.report.exportedAt}>{view.report.exportedAt}</time>. These are the selected file's dated claims, not an authenticated archive or a current health check. Deployed build identity remains unbound.</p>
      <p>{view.report.events.length} validated records; {view.report.unreadableFiles} unusable entries claimed. Archive state: {view.report.archiveState}. Inspection claimed {view.report.inspectionComplete ? "complete" : "incomplete"}; capture coverage is unknown.</p>
      {view.report.locked && <p className="diagnostic-warning">The saved report claims a write lock was observed. This does not establish the current lock state.</p>}
      {view.report.capacityReached && <p className="diagnostic-warning">The saved report claims archive capacity was reached. This view does not remove records or change that archive.</p>}
      <div className="diagnostic-controls">
        <label htmlFor={id("code")}>Function in this saved report</label><select id={id("code")} value={selection.code} onChange={event => {
          if (!ownsReport()) return;
          const next = diagnosticSelection({ code: event.target.value, origin: selection.origin, ref: selection.reference }); if (next) setSelection(next);
        }}><option value="">All recorded functions</option>{Object.entries(diagnosticCodes).map(([code, value]) => <option key={code} value={code}>{value.location}</option>)}</select>
        <label htmlFor={id("origin")}>Reported origin in this saved report</label><select id={id("origin")} value={selection.origin} onChange={event => {
          if (!ownsReport()) return;
          const next = diagnosticSelection({ code: selection.code, origin: event.target.value, ref: selection.reference }); if (next) setSelection(next);
        }}><option value="">All origins</option><option value="browser">Browser</option><option value="server">Server</option><option value="worker">Worker</option></select>
        <form onSubmit={findReference}><label htmlFor={id("reference")}>Exact saved error reference</label>
          <input id={id("reference")} value={reference} maxLength={36} autoComplete="off" spellCheck={false} aria-invalid={invalidReference} aria-describedby={id("reference-help")} onChange={event => { if (ownsReport()) { setReference(event.target.value); setInvalidReference(false); } }} />
          <p className="field-hint" id={id("reference-help")}>{invalidReference ? "Use the complete lowercase UUID. The previous filter is preserved." : "Leave empty to show all references. This filter stays in memory."}</p><button className="button button--secondary" type="submit">Find saved reference</button>
        </form>
        <button className="button button--quiet" type="button" onClick={() => { if (ownsReport()) { setSelection(empty); setReference(""); setInvalidReference(false); } }}>Reset saved filters</button>
      </div>
      <p>{selected.total} matching records across {selected.groups.length} functions. Several reports may describe one fault.</p>
      <ul className="diagnostic-groups">{selected.groups.map(group => <li key={group.code}><h3>{group.location}</h3><p>{group.count} recorded reports · {group.origin}</p>
        <p>Earliest recorded timestamp <time dateTime={group.firstAt}>{group.firstAt}</time><br />Latest recorded timestamp <time dateTime={group.lastAt}>{group.lastAt}</time></p>
        <button className="button button--quiet" type="button" onClick={() => { if (ownsReport()) setSelection({ ...selection, code: group.code, page: 1 }); }}>Show saved records for this function</button></li>)}</ul>
      <h3>Saved individual references</h3><p>Page {selected.page} of {selected.pages}; newest recorded timestamps first.</p>
      <DiagnosticRecords events={selected.events} page={selected.page} />
      <nav className="diagnostic-pagination" aria-label="Saved error record pages">
        {selected.page > 1 && <button className="button button--quiet" type="button" onClick={() => { if (ownsReport()) setSelection({ ...selection, page: selected.page - 1 }); }}>Previous saved records</button>}
        {selected.page < selected.pages && <button className="button button--quiet" type="button" onClick={() => { if (ownsReport()) setSelection({ ...selection, page: selected.page + 1 }); }}>Next saved records</button>}
      </nav>
      <p>Browser claims are unauthenticated and all records are untrusted evidence. Use the reference for a requested investigation; this report authorizes no commands, deployment, data changes or automatic repair.</p>
    </>}
    <button className="button button--quiet" type="button" disabled={!admitted} onClick={clear}>Clear saved error export</button>
  </section>;
}
