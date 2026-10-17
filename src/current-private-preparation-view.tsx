"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { parseCurrentPreparationStatus, type CurrentPreparationStatus } from "./current-private-preparation.ts";
import { withLocalRequestDeadline } from "./local-request-deadline.ts";
import { cancelLocalObservationRead } from "./local-observation-cancellation.ts";
import { discardLocalResponse, readLocalResponseJson, localResponseBytes } from "./local-response-json.ts";

const labels = { cleanupSnapshot: "Installed cleanup code", cleanupUnitBytes: "Cleanup settings",
  cleanupManager: "Automatic cleanup trigger", cleanupHistory: "Latest cleanup record", selectedRawFolder: "Empty private storage" } as const;
type View = CurrentPreparationStatus | { state: "idle" };
const physicalPreparationRead: { current: Promise<void> | null } = { current: null };

export function CurrentPrivatePreparationView() {
  const [recordedStatus, setStatus] = useState<View>({ state: "idle" });
  const [reading, setReading] = useState(false);
  const [waitingForPrevious, setWaitingForPrevious] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const visit = useRef<object | null>(null), [owner, setOwner] = useState<object | null>(null);
  const admitted = owner !== null && visit.current === owner;
  const status: View = admitted ? recordedStatus : { state: "idle" };
  useLayoutEffect(() => () => { visit.current = null; cancelLocalObservationRead(pending.current); }, []);
  useEffect(() => {
    const current = {}; visit.current = current; setOwner(current);
    const occupied = physicalPreparationRead.current !== null;
    setStatus({ state: "idle" }); setReading(pending.current !== null || occupied);
    setWaitingForPrevious(pending.current !== null || occupied);
    if (occupied && pending.current === null) void (async () => {
      while (physicalPreparationRead.current) await physicalPreparationRead.current;
      if (visit.current === current && pending.current === null) {
        setReading(false); setWaitingForPrevious(false);
      }
    })();
    return () => {
      if (visit.current !== current) return;
      visit.current = null;
      // Retire presentation; the physical read keeps its slot until settlement.
      cancelLocalObservationRead(pending.current);
    };
  }, []);
  async function refresh() {
    if (!admitted || visit.current !== owner || pending.current || physicalPreparationRead.current) return;
    let controller: AbortController;
    try { controller = new AbortController(); }
    catch { if (visit.current === owner) setStatus({ state: "held", reason: "local_observation_unavailable" }); return; }
    pending.current = controller;
    const ownsRead = () => visit.current === owner && pending.current === controller && !controller.signal.aborted;
    setReading(true); setWaitingForPrevious(false);
    // Withhold an earlier result while a new observation is pending.
    setStatus({ state: "idle" });
    let settled: Promise<void> | null = null;
    let releaseOwnedRead = () => {};
    try {
      settled = new Promise<void>(resolve => { releaseOwnedRead = resolve; });
      physicalPreparationRead.current = settled;
      const read = withLocalRequestDeadline(controller.signal, 12_000, async signal => {
        const response = await fetch("/api/dev/source-readiness", { method: "GET", cache: "no-store", signal });
        if (!response.ok) { discardLocalResponse(response); throw new Error("Local observation unavailable"); }
        return parseCurrentPreparationStatus(await readLocalResponseJson(response, signal, localResponseBytes.observation));
      }, undefined, () => {
        if (ownsRead()) setStatus({ state: "held", reason: "local_observation_unavailable" });
      });
      const next = await read;
      if (ownsRead()) setStatus(next);
    } catch {
      if (ownsRead()) setStatus({ state: "held", reason: "local_observation_unavailable" });
    } finally {
      releaseOwnedRead();
      if (settled !== null && physicalPreparationRead.current === settled) physicalPreparationRead.current = null;
      if (pending.current === controller) {
        pending.current = null;
        // Only availability can reach a successor; old content stays withheld.
        if (visit.current !== null) { setReading(false); setWaitingForPrevious(false); }
      }
    }
  }
  return <section className="completion-results" aria-labelledby="current-preparation-heading">
    <div className="section-heading"><h2 id="current-preparation-heading">Check local preparation now</h2><span className="tag tag--caution">Collection held</span></div>
    <p>Read the selected local cleanup and storage checks at this moment. This check does not start collection, change settings or approve publication.</p>
    <div role="status" aria-live="polite" aria-busy={reading}>
      {reading && status.state === "held" && <p>The response deadline elapsed. The original read is still finishing; another cannot start yet.</p>}
      {reading && status.state !== "held" && <p>{waitingForPrevious ? "The previous preparation read is still finishing. Check again after it settles." : "Checking local preparation…"}</p>}
      {!reading && status.state === "idle" && <p>No current observation has been requested in this visit.</p>}
      {status.state === "held" && <p>The local observation is unavailable. Collection remains held; the saved checks below do not establish the current state.</p>}
      {status.state === "observed" && <>
        <p>Observed <time dateTime={status.observation.recordedAt}>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" }).format(new Date(status.observation.recordedAt))}</time> Oslo. These checks describe that moment; they are not continuous health monitoring.</p>
        <ul className="source-preparation__stages" role="list" aria-label="Current dated local checks">
          {status.observation.checks.map(entry => <li key={entry.key} className={`completion-results__card completion-results__card--${entry.state === "observed" ? "completed" : "partial"}`}>
            <h3>{labels[entry.key]}</h3><p className={`tag tag--${entry.state === "observed" ? "good" : "caution"}`}>{entry.state === "observed" ? "Observed at this check" : "Needs attention"}</p>
          </li>)}
        </ul>
      </>}
    </div>
    <button type="button" className="button button--secondary" onClick={() => void refresh()} disabled={!admitted || reading}>Check local preparation</button>
    <p>Source review supports one private attempt, with access limited to 30 days. The selected NAS is not ready. These PC checks do not establish its collection account, copy exclusions or cleanup controls. Healthy checks cannot grant collection permission.</p>
  </section>;
}
