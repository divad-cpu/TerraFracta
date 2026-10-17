"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { readWeeklyRehearsalReport, WEEKLY_REPORT_BYTE_LIMIT, type WeeklyRehearsalReport } from "./weekly-rehearsal-report.ts";
import { weeklyRehearsalTimingFields } from "./weekly-rehearsal-timing.ts";
import { weeklyRehearsalReasonMeanings } from "./weekly-rehearsal-reasons.ts";
import { withLocalRequestDeadline } from "./local-request-deadline.ts";

type View = { state: "idle" | "reading" | "held" | "busy" } | { state: "loaded"; report: WeeklyRehearsalReport };
const physicalWeeklyReportRead: { current: Promise<void> | null } = { current: null };
function cancelReportRead(controller: AbortController | null) {
  // Presentation retires independently; the physical read keeps its slot until
  // settlement even if the platform cannot perform the requested abort.
  try { controller?.abort(); } catch { /* Continue the owned presentation cleanup. */ }
}
export function WeeklyRehearsalReportView() {
  const [recordedView, setView] = useState<View>({ state: "idle" }), [reading, setReading] = useState(false);
  const generation = useRef(0), visit = useRef<object | null>(null), pending = useRef<AbortController | null>(null);
  const observation = useRef<WeeklyRehearsalReport | null>(null), [owner, setOwner] = useState<object | null>(null);
  const admitted = owner !== null && visit.current === owner, renderedGeneration = generation.current;
  const view: View = admitted && (recordedView.state !== "loaded" || observation.current === recordedView.report)
    ? recordedView : { state: "idle" };
  const ownsView = () => admitted && visit.current === owner && renderedGeneration === generation.current;
  function clear() {
    if (!ownsView()) return;
    generation.current++; observation.current = null; cancelReportRead(pending.current); setView({ state: "idle" });
  }
  async function select(file: File | undefined) {
    if (!ownsView()) return;
    if (!file) { clear(); return; }
    const current = ++generation.current; observation.current = null;
    if (pending.current || physicalWeeklyReportRead.current) { cancelReportRead(pending.current); setView({ state: "busy" }); return; }
    const isCurrent = () => visit.current === owner && current === generation.current;
    let controller: AbortController;
    try { controller = new AbortController(); }
    catch { if (isCurrent()) setView({ state: "held" }); return; }
    pending.current = controller;
    setReading(true); setView({ state: "reading" });
    let settled: Promise<void> | null = null;
    let releaseOwnedRead = () => {};
    try {
      settled = new Promise<void>(resolve => { releaseOwnedRead = resolve; });
      physicalWeeklyReportRead.current = settled;
      const read = withLocalRequestDeadline(controller.signal, 8_000, async signal => {
        const size = file.size;
        if (!Number.isSafeInteger(size) || size < 2 || size > WEEKLY_REPORT_BYTE_LIMIT) throw new Error("Report size refused");
        const bytes = await file.slice(0, WEEKLY_REPORT_BYTE_LIMIT + 1).arrayBuffer();
        if (signal.aborted || !isCurrent()) throw new Error("Report read retired");
        return readWeeklyRehearsalReport(bytes, size);
      }, undefined, () => {
        cancelReportRead(controller);
        if (isCurrent()) setView({ state: "held" });
      });
      const report = await read;
      if (isCurrent()) { observation.current = report; setView({ state: "loaded", report }); }
    } catch { if (isCurrent()) setView({ state: "held" }); }
    finally {
      releaseOwnedRead();
      if (settled !== null && physicalWeeklyReportRead.current === settled) physicalWeeklyReportRead.current = null;
      if (pending.current === controller) {
        pending.current = null;
        // A retired physical read releases only availability to its successor.
        if (visit.current !== null) setReading(false);
      }
    }
  }
  useLayoutEffect(() => () => {
    visit.current = null; observation.current = null; generation.current++; cancelReportRead(pending.current);
  }, []);
  useEffect(() => {
    const current = {}; visit.current = current; setOwner(current); observation.current = null;
    generation.current++; setView({ state: "idle" });
    const occupied = physicalWeeklyReportRead.current !== null;
    setReading(pending.current !== null || occupied);
    if (occupied && pending.current === null) void (async () => {
      while (physicalWeeklyReportRead.current) await physicalWeeklyReportRead.current;
      if (visit.current === current && pending.current === null) setReading(false);
    })();
    return () => {
      if (visit.current !== current) return;
      visit.current = null; observation.current = null; generation.current++; cancelReportRead(pending.current);
    };
  }, []);
  const time = (value: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Oslo", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  return <section className="completion-results" aria-labelledby="saved-weekly-report-heading">
    <div className="section-heading"><h2 id="saved-weekly-report-heading">Open a saved rehearsal assessment</h2><span className="tag tag--caution">Historical fictional report</span></div>
    <p>Select a previously downloaded assessment, up to 16 KiB. This reads the file locally in your browser; it is not uploaded or added to the run history.</p>
    <label className="small-note">Choose a local JSON assessment <input type="file" accept=".json,application/json" disabled={!admitted || reading} onChange={event => {
      if (!ownsView()) return;
      const input = event.currentTarget, file = input.files?.[0]; input.value = ""; void select(file);
    }} /></label>
    <div role="status" aria-live="polite" aria-busy={reading}>
      {view.state === "idle" && <p>No local report has been selected.</p>}
      {view.state === "reading" && <p>Checking the selected local report…</p>}
      {view.state === "held" && <p>The selected file could not be read as a bounded fictional assessment. Earlier report contents are withheld.</p>}
      {view.state === "busy" && <p>{reading ? "A previous file read is still finishing. This file was not read." : "The previous read has finished. Choose the file again to inspect it."}</p>}
      {reading && view.state !== "reading" && <p>The previous read still owns its slot. Clearing or cancellation does not start another read.</p>}
      {view.state === "loaded" && <>
        <p>Report observation: <time dateTime={view.report.observation.observedAt}>{time(view.report.observation.observedAt)}</time> Oslo. Example window: {view.report.observation.windowKey}.</p>
        <p>Recorded outcome: <strong>{view.report.observation.state}</strong>. Reason: <code>{view.report.observation.reason}</code>. Coverage: {view.report.observation.coverage}.</p>
        <p>Recorded reason explanation: <strong>{weeklyRehearsalReasonMeanings[view.report.observation.reason]}</strong></p>
        <p>{view.report.observation.totalReceipts} recorded receipts, {view.report.observation.unreadableReceipts} withheld, {view.report.observation.pendingReceipts} incomplete writing attempts.</p>
        <details>
          <summary>Exact recorded rehearsal times</summary>
          <p>The overview uses Oslo time at minute precision. These UTC values preserve the recorded precision of the fictional assessment.</p>
          <dl aria-label="Exact recorded rehearsal timing">{weeklyRehearsalTimingFields(view.report.observation).map(field => <div key={field.label}>
            <dt>{field.label}</dt><dd>{field.utc ? <time dateTime={field.value}><code>{field.value}</code></time> : field.value}</dd>
          </div>)}</dl>
          <p>These fields do not establish a trusted clock, live operation, source freshness or an enabled schedule.</p>
        </details>
        <p>This is the selected report's dated claim, not an authenticated receipt or a current inspection. It cannot enable collection, alerts, publication or a schedule.</p>
      </>}
    </div>
    <button type="button" className="button button--quiet" disabled={!admitted} onClick={clear}>Clear local report</button>
  </section>;
}
