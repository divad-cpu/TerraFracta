"use client";

import { useEffect, useRef, useState } from "react";
import { type PrivateCustodianOperationStatus } from "./private-custodian-operation";
import { requestPrivateCustodianStatus } from "./private-custodian-request";

export function PrivateCustodianOperationView() {
  const [status, setStatus] = useState<PrivateCustodianOperationStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reading, setReading] = useState(false);
  const [deadlineNotice, setDeadlineNotice] = useState<"status" | "start" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingRequest = useRef<AbortController | null>(null);
  const pendingRead = useRef<AbortController | null>(null);
  const latestStatus = useRef<PrivateCustodianOperationStatus | null>(null);
  const activeView = useRef(false);
  const phase = status?.state;
  const confirmedStatus = status?.state === "idle" && latestStatus.current === null ? null : status;
  function showStatus(value: PrivateCustodianOperationStatus | null) {
    latestStatus.current = value;setStatus(value);
  }

  useEffect(() => {
    if ((phase === "idle" || phase === "checked" || phase === "held") && latestStatus.current?.state === phase) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function inspect() {
      if (pendingRead.current || controller.signal.aborted) return;
      pendingRead.current = controller;setReading(true);setDeadlineNotice(null);
      try {
        const next = await requestPrivateCustodianStatus("GET", controller.signal, () => {
          if (pendingRead.current === controller && !controller.signal.aborted) setDeadlineNotice("status");
        });
        if (pendingRead.current !== controller || controller.signal.aborted) return;
        showStatus(next);setError(null);
        if (next.state === "running") timer = setTimeout(inspect, 1_000);
      } catch {
        if (pendingRead.current === controller && !controller.signal.aborted) setError("The local test status could not be read. Reloading checks the same attempt; it does not start another.");
      } finally {
        if (pendingRead.current === controller) {
          pendingRead.current = null;
          if (!controller.signal.aborted) { setReading(false);setDeadlineNotice(null); }
        }
      }
    }
    if (phase === "running") timer = setTimeout(inspect, 1_000);
    else void inspect();
    return () => {
      // Retire this observation context before a replacement effect is set up.
      // Its late notice/result cannot own or update the replacement context.
      if (pendingRead.current === controller) pendingRead.current = null;
      controller.abort();if (timer !== undefined) clearTimeout(timer);
    };
  }, [phase]);

  useEffect(() => {
    activeView.current = true;
    return () => { activeView.current = false;pendingRequest.current?.abort(); };
  }, []);

  async function start() {
    if (!activeView.current || latestStatus.current?.state !== "idle" || pendingRequest.current !== null || pendingRead.current !== null) return;
    const controller = new AbortController();pendingRequest.current = controller;
    // Starting retires idle admission even if its observation effect reconnects.
    latestStatus.current = null;
    setSubmitting(true);setError(null);setDeadlineNotice(null);
    try {
      const next = await requestPrivateCustodianStatus("POST", controller.signal, () => {
        if (pendingRequest.current === controller && !controller.signal.aborted) setDeadlineNotice("start");
      });
      if (!controller.signal.aborted) showStatus(next);
    } catch {
      if (!controller.signal.aborted) {
        setError("The start response could not be confirmed. Inspecting the recorded attempt before any further action.");
        showStatus(null);
      }
    } finally {
      if (pendingRequest.current === controller) {
        pendingRequest.current = null;
        if (activeView.current) {
          setSubmitting(false);
          if (pendingRead.current === null) setDeadlineNotice(null);
        }
      }
    }
  }

  return (
    <section className="completion-results" aria-labelledby="private-test-heading">
      <div className="section-heading"><h2 id="private-test-heading">Try the collection path with sample answers</h2><span className="tag tag--caution">Local test</span></div>
      <p>Run the connected private test with invented answers. It saves one sample pair in a separate test database and private sample folder. No real source is contacted and nothing is published.</p>
      <button type="button" className="button button--primary" onClick={() => void start()} disabled={confirmedStatus?.state !== "idle" || submitting || reading}>Run the invented collection test</button>
      <div role="status" aria-live="polite" aria-atomic="true" aria-busy={reading || submitting}>
        {confirmedStatus === null && reading && <p>Reading the local test status…</p>}
        {confirmedStatus === null && !reading && <p>The local test status is unconfirmed. Reloading inspects the same attempt.</p>}
        {submitting && <p>The start request is awaiting confirmation. No further start can be requested.</p>}
        {confirmedStatus?.state === "running" && <p>The last confirmed status was running. Reloading reads this attempt and does not start another.</p>}
        {reading && confirmedStatus !== null && <p>Reading the current status of this attempt…</p>}
        {deadlineNotice === "status" && <p>The status-response deadline elapsed. The original read is still finishing; another status read cannot start yet.</p>}
        {deadlineNotice === "start" && <p>The start-response deadline elapsed. The original request is still finishing. Its outcome is unconfirmed; another start cannot be requested.</p>}
        {confirmedStatus?.state === "idle" && !submitting && !reading && <p>A new sample test is available. Its start and result are retained. Repeated starts and app restarts inspect this same attempt.</p>}
        {confirmedStatus?.state === "held" && <p><strong>Test held.</strong> Its outcome could not be confirmed. Existing evidence is kept and the test will not restart automatically.</p>}
        {confirmedStatus?.state === "checked" && <>
          <p><strong>Sample saving checked.</strong> One pair was saved, matched and closed. The {confirmedStatus.result.selectedYears.join(" and ")} observations remain private and pending.</p>
          <p>Recorded <time dateTime={confirmedStatus.result.recordedAt}>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" }).format(new Date(confirmedStatus.result.recordedAt))}</time> Oslo. This saved result uses invented data; it does not describe current source or storage health.</p>
        </>}
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
