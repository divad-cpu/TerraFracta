"use client";

import { useEffect, useRef, useState } from "react";
import { parseCorrectionReviewOperationStatus, parseSupervisedCorrectionReviewOperationStatus, type ReviewObservation } from "./correction-review-operation.ts";
import { withLocalRequestDeadline } from "./local-request-deadline.ts";
import { discardLocalResponse, readLocalResponseJson, localResponseBytes } from "./local-response-json.ts";

type View = ReviewObservation | { state: "loading" };
type ViewOwner = { supervised: boolean };
export function CorrectionReviewOperationView({ supervised = false }: { supervised?: boolean } = {}) {
  const visit = useRef<ViewOwner | null>(null);
  const [observation, setObservation] = useState<{ owner: ViewOwner | null; status: View }>({ owner: null, status: { state: "loading" } });
  // Mode reuse cannot revive a retired effect's observation or controls.
  const owner = visit.current;
  const current = owner !== null && owner.supervised === supervised;
  const status: View = current && observation.owner === owner ? observation.status : { state: "loading" };
  const [reading, setReading] = useState(false);
  const pending = useRef<AbortController | null>(null);

  async function refresh(owner: ViewOwner | null) {
    if (owner === null || visit.current !== owner || owner.supervised !== supervised || pending.current) return;
    const controller = new AbortController(); pending.current = controller; setReading(true);
    setObservation({ owner, status: { state: "loading" } });
    try {
      const endpoint = supervised ? "/api/dev/supervised-correction-review" : "/api/dev/correction-review";
      const next = await withLocalRequestDeadline(controller.signal, 8_000, async signal => {
        const response = await fetch(endpoint, { method: "GET", cache: "no-store", signal });
        if (!response.ok) { discardLocalResponse(response); throw new Error("Review observation unavailable"); }
        const parse = supervised ? parseSupervisedCorrectionReviewOperationStatus : parseCorrectionReviewOperationStatus;
        return parse(await readLocalResponseJson(response, signal, localResponseBytes.observation));
      }, undefined, () => {
        if (visit.current === owner && pending.current === controller && !controller.signal.aborted) setObservation({ owner, status: { state: "held", reason: "private_test_unavailable" } });
      });
      if (visit.current === owner && pending.current === controller) setObservation({ owner, status: next });
    } catch {
      if (visit.current === owner && pending.current === controller) setObservation({ owner, status: { state: "held", reason: "private_test_unavailable" } });
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        // A retired read releases only availability to an admitted successor.
        if (visit.current !== null) setReading(false);
      }
    }
  }
  useEffect(() => {
    const owner = { supervised }; visit.current = owner;
    setObservation({ owner, status: { state: "loading" } });
    setReading(pending.current !== null);
    void refresh(owner);
    return () => {
      if (visit.current !== owner) return;
      visit.current = null;
      // Effect recreation or a mode change cannot abandon a physical read.
      pending.current?.abort();
    };
  }, [supervised]);

  return <section className="completion-results" aria-labelledby="retained-review-heading">
    <div className="section-heading"><h2 id="retained-review-heading">{supervised ? "Saved review and completion" : "Retained local review result"}</h2><span className="tag tag--caution">Invented reports only</span></div>
    <p>This view reads the result of a separate, manually started local trial. Reloading or checking again does not start a trial or change a report.</p>
    <div role="status" aria-live="polite" aria-busy={reading}>
      {status.state === "loading" && <p>{reading ? "Reading the saved result…" : "No current saved result has been requested in this visit. Check the saved result to request a new observation."}</p>}
      {reading && status.state === "held" && <p>The response deadline elapsed. The original read is still finishing; another cannot start yet.</p>}
      {status.state === "idle" && <p>No retained trial has been started. This view cannot start one.</p>}
      {status.state === "running" && <p>The manual trial is still running. Check the result again after it finishes.</p>}
      {status.state === "held" && <p>The saved result is unavailable or the trial did not finish. Inspect the private evidence before another attempt; this view cannot repair or retry it.</p>}
      {status.state === "checked" && <>
        <p>The saved trial completed. Four invented reports stayed private: {status.result.newReports} await review, {status.result.underReviewReports} is under review and {status.result.closedReports} is closed.</p>
        <p>Three review steps were retained. Replaying an earlier step did not reopen the closed report.</p>
        <p>Recorded <time dateTime={status.result.recordedAt}>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" }).format(new Date(status.result.recordedAt))}</time> Oslo. The saved result does not show current account or process status.</p>
        <p>The trial verified temporary account retirement and stopped its owned test environment at completion. No real reports, source requests or model calls were used.</p>
        {status.result.evidenceKind === "fresh_invented_supervised_correction_review_result_v3" && <p>The saved trial also recorded that its worker had finished. Failed or uncertain attempts stay in the private history; this view does not repeat them.</p>}
      </>}
    </div>
    <button type="button" className="button button--secondary" onClick={() => void refresh(owner)} disabled={!current || reading}>Check saved result</button>
    <p>Real review access and privacy rules remain to be selected. Closing an invented report did not change displayed facts.</p>
  </section>;
}
