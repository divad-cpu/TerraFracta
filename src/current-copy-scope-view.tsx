"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { parseCurrentCopyScopeStatus, type CurrentCopyScopeStatus } from "./current-copy-scope.ts";
import { withLocalRequestDeadline } from "./local-request-deadline.ts";
import { cancelLocalObservationRead } from "./local-observation-cancellation.ts";
import { discardLocalResponse, readLocalResponseJson, localResponseBytes } from "./local-response-json.ts";

type View = CurrentCopyScopeStatus | { state: "idle" };
const physicalCopyScopeRead: { current: Promise<void> | null } = { current: null };
export function CurrentCopyScopeView() {
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
    const occupied = physicalCopyScopeRead.current !== null;
    setStatus({ state: "idle" }); setReading(pending.current !== null || occupied);
    setWaitingForPrevious(pending.current !== null || occupied);
    if (occupied && pending.current === null) void (async () => {
      while (physicalCopyScopeRead.current) await physicalCopyScopeRead.current;
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
    if (!admitted || visit.current !== owner || pending.current || physicalCopyScopeRead.current) return;
    let controller: AbortController;
    try { controller = new AbortController(); }
    catch { if (visit.current === owner) setStatus({ state: "held", reason: "copy_observation_unavailable" }); return; }
    pending.current = controller;
    const ownsRead = () => visit.current === owner && pending.current === controller && !controller.signal.aborted;
    setReading(true); setWaitingForPrevious(false); setStatus({ state: "idle" });
    let settled: Promise<void> | null = null;
    let releaseOwnedRead = () => {};
    try {
      settled = new Promise<void>(resolve => { releaseOwnedRead = resolve; });
      physicalCopyScopeRead.current = settled;
      const read = withLocalRequestDeadline(controller.signal, 8_000, async signal => {
        const response = await fetch("/api/dev/copy-scope", { method: "GET", cache: "no-store", signal });
        if (!response.ok) { discardLocalResponse(response); throw new Error("Copy observation unavailable"); }
        return parseCurrentCopyScopeStatus(await readLocalResponseJson(response, signal, localResponseBytes.observation));
      }, undefined, () => {
        if (ownsRead()) setStatus({ state: "held", reason: "copy_observation_unavailable" });
      });
      const value = await read;
      if (ownsRead()) setStatus(value);
    } catch {
      if (ownsRead()) setStatus({ state: "held", reason: "copy_observation_unavailable" });
    } finally {
      releaseOwnedRead();
      if (settled !== null && physicalCopyScopeRead.current === settled) physicalCopyScopeRead.current = null;
      if (pending.current === controller) {
        pending.current = null;
        // Only availability can reach a successor; old content stays withheld.
        if (visit.current !== null) { setReading(false); setWaitingForPrevious(false); }
      }
    }
  }
  return <section className="completion-results" aria-labelledby="copy-scope-heading">
    <div className="section-heading"><h2 id="copy-scope-heading">Backup and sync coverage</h2><span className="tag tag--caution">Collection held</span></div>
    <p>Check the selected backup exclusion and whether a local sync setup exists. This reads limited settings and entry metadata; it does not start a backup or read saved source responses.</p>
    <div role="status" aria-live="polite" aria-busy={reading}>
      {reading && status.state === "held" && <p>The response deadline elapsed. The original read is still finishing; another cannot start yet.</p>}
      {reading && status.state !== "held" && <p>{waitingForPrevious ? "The previous copy-setting read is still finishing. Check again after it settles." : "Checking copy settings…"}</p>}
      {!reading && status.state === "idle" && <p>No copy-setting observation has been requested in this visit.</p>}
      {status.state === "held" && <p>The copy-setting observation is unavailable. Earlier results cannot establish the current coverage.</p>}
      {status.state === "observed" && <>
        <p>Observed <time dateTime={status.observation.recordedAt}>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" }).format(new Date(status.observation.recordedAt))}</time> Oslo. This describes that moment, not continuous monitoring.</p>
        <ul className="source-preparation__stages" role="list" aria-label="Limited copy-setting observations">
          <li className="completion-results__card completion-results__card--partial"><h3>Selected backup exclusion</h3>
            <p>{status.observation.backupExclusion === "observed" ? "A configured exclusion matched the selected folder and sample descendants." : "A supported exclusion was not established by this check."}</p>
            <p>Matching settings do not prove what existing backups contain.</p></li>
          <li className="completion-results__card completion-results__card--partial"><h3>Local sync setup</h3>
            <p>{status.observation.syncSetup === "present" ? "A configuration entry exists. Its contents were not read." : status.observation.syncSetup === "not_found" ? "No entry was found at the selected configuration location." : "The selected configuration entry could not be observed."}</p>
            <p>This check does not discover every sync program or copying job.</p></li>
          <li className="completion-results__card completion-results__card--partial"><h3>Other copies and destinations</h3>
            <p>The owner reports no current copying of the original PC raw folder and requires future Google Drive/NAS copying to exclude it. This local check does not establish the selected NAS deployment's copy coverage. No complete-copy approval is issued.</p></li>
        </ul>
      </>}
    </div>
    <button type="button" className="button button--secondary" onClick={() => void refresh()} disabled={!admitted || reading}>Check copy settings</button>
    <p>The selected NAS is not ready. Its private collection setup and copy exclusions need installation verification before collection. This local observation changes no settings or permissions.</p>
  </section>;
}
