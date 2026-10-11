"use client";
import { useEffect, useRef, useState } from "react";
import { parseCurrentParentSource, type CurrentParentSourceStatus } from "./current-parent-source.ts";
import { withLocalRequestDeadline } from "./local-request-deadline.ts";
import { discardLocalResponse, readLocalResponseJson, localResponseBytes } from "./local-response-json.ts";

type View = CurrentParentSourceStatus | { state: "idle" };
export function CurrentParentSourceView() {
  const [recordedStatus, setStatus] = useState<View>({ state: "idle" }), [reading, setReading] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const visit = useRef<object | null>(null), [owner, setOwner] = useState<object | null>(null);
  const admitted = owner !== null && visit.current === owner;
  const status: View = admitted ? recordedStatus : { state: "idle" };
  useEffect(() => {
    const current = {}; visit.current = current; setOwner(current);
    setStatus({ state: "idle" }); setReading(pending.current !== null);
    return () => {
      if (visit.current !== current) return;
      visit.current = null;
      // Retire presentation; the physical read keeps its slot until settlement.
      pending.current?.abort();
    };
  }, []);
  async function refresh() {
    if (!admitted || visit.current !== owner || pending.current) return;
    const controller = new AbortController(); pending.current = controller;
    const ownsRead = () => visit.current === owner && pending.current === controller && !controller.signal.aborted;
    setReading(true); setStatus({ state: "idle" });
    try {
      const value = await withLocalRequestDeadline(controller.signal, 8_000, async signal => {
        const response = await fetch("/api/dev/parent-source", { method: "GET", cache: "no-store", signal });
        if (!response.ok) { discardLocalResponse(response); throw new Error("Comparison unavailable"); }
        return parseCurrentParentSource(await readLocalResponseJson(response, signal, localResponseBytes.observation));
      }, undefined, () => {
        if (ownsRead()) setStatus({ state: "held", reason: "parent_source_comparison_unavailable" });
      });
      if (ownsRead()) setStatus(value);
    } catch {
      if (ownsRead()) setStatus({ state: "held", reason: "parent_source_comparison_unavailable" });
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        // Only availability can reach a successor; old content stays withheld.
        if (visit.current !== null) setReading(false);
      }
    }
  }
  return <div className="info-band">
    <strong>Does the saved preparation still match?</strong>
    <div role="status" aria-live="polite" aria-busy={reading}>
      {reading && status.state === "held" && <p>The response deadline elapsed. The original read is still finishing; another cannot start yet.</p>}
      {reading && status.state !== "held" && <p>Comparing the prepared source files…</p>}
      {!reading && status.state === "idle" && <p>No current source comparison has been requested in this visit.</p>}
      {status.state === "held" && <p>The current comparison is unavailable. The saved preparation does not establish today's code.</p>}
      {status.state === "observed" && <>
        <p>Observed <time dateTime={status.observation.recordedAt}>{new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Oslo", dateStyle: "medium", timeStyle: "short" }).format(new Date(status.observation.recordedAt))}</time> Oslo. This is a point-in-time comparison of the {status.observation.preparedFiles} saved file names.</p>
        <p>{status.observation.comparison === "matched" ? "The prepared file bytes match at this check." : status.observation.comparison === "changed" ? "Prepared source files have changed. A new source target and its review are needed." : "Some prepared source files could not be compared. The result remains held."}</p>
        <p>{status.observation.matchedFiles} matched, {status.observation.changedFiles} changed, {status.observation.unavailableFiles} unavailable.</p>
      </>}
    </div>
    <button className="button button--secondary" type="button" onClick={() => void refresh()} disabled={!admitted || reading}>Compare prepared source now</button>
    <p>This compares saved file names only. A match does not approve the deployment, complete runtime or collection.</p>
  </div>;
}
