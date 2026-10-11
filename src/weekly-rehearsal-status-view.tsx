"use client";
import { useEffect, useRef, useState } from "react";
import { parseWeeklyRehearsalStatus, type WeeklyRehearsalStatus } from "./weekly-rehearsal-status.ts";
import { weeklyRehearsalTimingFields } from "./weekly-rehearsal-timing.ts";
import { weeklyRehearsalReasonMeanings } from "./weekly-rehearsal-reasons.ts";
import { exportWeeklyRehearsal } from "./weekly-rehearsal-export.ts";
import { withLocalRequestDeadline } from "./local-request-deadline.ts";
import { discardLocalResponse, readLocalResponseJson, localResponseBytes } from "./local-response-json.ts";
import { observeClientError } from "./client-error-diagnostics.ts";

type View = WeeklyRehearsalStatus | { state: "idle" };
export function WeeklyRehearsalStatusView() {
  const [recordedStatus, setStatus] = useState<View>({ state: "idle" }), [reading, setReading] = useState(false);
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const exportable = useRef<WeeklyRehearsalStatus | null>(null);
  const visit = useRef<object | null>(null), [owner, setOwner] = useState<object | null>(null);
  const admitted = owner !== null && visit.current === owner;
  const status: View = admitted ? recordedStatus : { state: "idle" };
  useEffect(() => {
    const current = {};
    visit.current = current; setOwner(current);
    exportable.current = null; setStatus({ state: "idle" }); setDownloadMessage(null);
    setReading(pending.current !== null);
    return () => {
      if (visit.current !== current) return;
      visit.current = null; exportable.current = null;
      // Retire presentation while the physical read keeps its slot until settlement.
      pending.current?.abort();
    };
  }, []);
  async function refresh() {
    if (!admitted || visit.current !== owner || pending.current) return;
    const controller = new AbortController(); pending.current = controller; exportable.current = null;
    const ownsRead = () => visit.current === owner && pending.current === controller && !controller.signal.aborted;
    setReading(true); setStatus({ state: "idle" }); setDownloadMessage(null);
    try {
      const value = await withLocalRequestDeadline(controller.signal, 8_000, async signal => {
        const response = await fetch("/api/dev/update-rehearsal/status", { method: "GET", cache: "no-store", signal });
        if (!response.ok) { discardLocalResponse(response); throw new Error("Weekly history unavailable"); }
        return parseWeeklyRehearsalStatus(await readLocalResponseJson(response, signal, localResponseBytes.observation));
      }, undefined, () => {
        if (ownsRead()) setStatus({ state: "held", reason: "weekly_rehearsal_unavailable" });
      });
      if (ownsRead()) { exportable.current = value.state === "observed" ? value : null; setStatus(value); }
    } catch {
      if (ownsRead()) setStatus({ state: "held", reason: "weekly_rehearsal_unavailable" });
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        // Only availability may reach an admitted successor; retired content stays withheld.
        if (visit.current !== null) setReading(false);
      }
    }
  }
  function download() {
    const ownsExport = () => admitted && visit.current === owner && pending.current === null &&
      status.state === "observed" && exportable.current === status;
    if (!ownsExport()) return;
    let url: string | null = null, link: HTMLAnchorElement | undefined;
    try {
      const exported = exportWeeklyRehearsal(status);
      if (!ownsExport()) return;
      url = URL.createObjectURL(new Blob([exported.body], { type: "application/json" }));
      if (!ownsExport()) return;
      link = document.createElement("a"); link.href = url; link.download = exported.filename;
      if (!ownsExport()) return;
      document.body.append(link);
      if (!ownsExport()) return;
      link.click();
      if (ownsExport()) setDownloadMessage("Download requested. The file preserves this dated fictional assessment; it does not establish current live operation.");
    } catch {
      if (ownsExport()) {
        observeClientError("weekly_assessment_export");
        setDownloadMessage("The assessment could not be exported. Its displayed result is preserved.");
      }
    }
    finally {
      try { link?.remove(); } catch { /* Preserve the original export outcome. */ }
      if (url !== null) {
        const allocated = url;
        const revoke = () => { try { URL.revokeObjectURL(allocated); } catch { /* Best-effort cleanup, without recursive diagnostics. */ } };
        try { setTimeout(revoke, 1_000); } catch { revoke(); }
      }
    }
  }
  const time = (value: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Oslo", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  return <section className="completion-results" aria-labelledby="weekly-history-heading">
    <div className="section-heading"><h2 id="weekly-history-heading">Checking a missed weekly rehearsal</h2><span className="tag tag--caution">Fictional history only</span></div>
    <p>This reads the complete bounded local receipt inventory and checks the current Monday 08:00 Oslo example window. A one-hour grace period is used for this rehearsal.</p>
    <div role="status" aria-live="polite" aria-busy={reading}>
      {reading && status.state === "held" && <p>The response deadline elapsed. The original read is still finishing; another cannot start yet.</p>}
      {reading && status.state !== "held" && <p>Inspecting saved rehearsal history…</p>}
      {!reading && status.state === "idle" && <p>No weekly history check has been requested in this visit.</p>}
      {status.state === "held" && <p>The weekly history could not be verified. Earlier results do not establish current coverage.</p>}
      {status.state === "observed" && <>
        <p>Observed <time dateTime={status.observation.observedAt}>{time(status.observation.observedAt)}</time> Oslo. Example due time: <time dateTime={status.observation.dueAt}>{time(status.observation.dueAt)}</time> Oslo.</p>
        <p><strong>{weeklyRehearsalReasonMeanings[status.observation.reason]}</strong></p>
        <p>{status.observation.totalReceipts} saved receipts, {status.observation.unreadableReceipts} withheld, {status.observation.pendingReceipts} incomplete writing attempts.</p>
        <details>
          <summary>Exact recorded rehearsal times</summary>
          <p>The overview uses Oslo time at minute precision. These UTC values preserve the recorded precision of the fictional assessment.</p>
          <dl aria-label="Exact recorded rehearsal timing">{weeklyRehearsalTimingFields(status.observation).map(field => <div key={field.label}>
            <dt>{field.label}</dt><dd>{field.utc ? <time dateTime={field.value}><code>{field.value}</code></time> : field.value}</dd>
          </div>)}</dl>
          <p>These fields do not establish a trusted clock, live operation, source freshness or an enabled schedule.</p>
        </details>
      </>}
    </div>
    <button type="button" className="button button--secondary" disabled={!admitted || reading} onClick={() => void refresh()}>Check weekly rehearsal history</button>
    {status.state === "observed" && !reading && <button type="button" className="button button--quiet" onClick={download}>Download dated rehearsal assessment</button>}
    {downloadMessage && <p role="status">{downloadMessage}</p>}
    <p>This is a local demonstration, not a trusted live run ledger. No real schedule is enabled, no alert is sent, and no update starts from this check.</p>
  </section>;
}
