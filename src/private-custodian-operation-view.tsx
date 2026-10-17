"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type PrivateCustodianOperationStatus } from "./private-custodian-operation";
import { requestPrivateCustodianStatus } from "./private-custodian-request";
import { cancelLocalObservationRead } from "./local-observation-cancellation.ts";

// A route remount must inherit an old GET that ignores its former view's abort.
const physicalStatusRead: { current: Promise<void> | null } = { current: null };
const physicalStartRequest: { current: Promise<void> | null } = { current: null };

export function PrivateCustodianOperationView() {
  const [status, setStatus] = useState<PrivateCustodianOperationStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reading, setReading] = useState(false);
  const [deadlineNotice, setDeadlineNotice] = useState<"status" | "start" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waitingForPrevious, setWaitingForPrevious] = useState(false);
  const [waitingForPreviousStart, setWaitingForPreviousStart] = useState(false);
  const pendingRequest = useRef<AbortController | null>(null);
  const pendingStartVisit = useRef<number | null>(null);
  const pendingRead = useRef<AbortController | null>(null);
  const waitingObservation = useRef<(() => void) | null>(null);
  const observationController = useRef<AbortController | null>(null);
  const observationSetupRefused = useRef(false);
  const latestStatus = useRef<PrivateCustodianOperationStatus | null>(null);
  const activeView = useRef(false);
  const viewVisit = useRef(0);
  const [admittedVisit, setAdmittedVisit] = useState<number | null>(null);
  const representedVisit = viewVisit.current;
  const admittedView = activeView.current && admittedVisit === representedVisit;
  const ownsView = () => admittedView && activeView.current && viewVisit.current === representedVisit;

  useLayoutEffect(() => () => {
    activeView.current = false;
    viewVisit.current++;
    latestStatus.current = null;
    observationSetupRefused.current = false;
    const previousObservation = observationController.current;
    observationController.current = null;
    waitingObservation.current = null;
    cancelLocalObservationRead(previousObservation);
    cancelLocalObservationRead(pendingRead.current);
    cancelLocalObservationRead(pendingRequest.current);
  }, []);
  const phase = status?.state;
  const confirmedStatus = status?.state === "idle" && latestStatus.current === null ? null : status;
  function showStatus(value: PrivateCustodianOperationStatus | null) {
    latestStatus.current = value;setStatus(value);
  }
  function resumeWaitingObservation() {
    const waiting = waitingObservation.current;
    waitingObservation.current = null;
    waiting?.();
  }

  useEffect(() => {
    if (observationSetupRefused.current) return;
    if ((phase === "idle" || phase === "checked" || phase === "held") && latestStatus.current?.state === phase) return;
    const observationVisit = viewVisit.current;
    const previousObservation = observationController.current;
    let controller: AbortController;
    try { controller = new AbortController(); }
    catch {
      // Allocation may retire this visit or establish a newer observation.
      if (viewVisit.current === observationVisit && observationController.current === previousObservation) {
        observationSetupRefused.current = true;
        showStatus(null);setReading(false);setDeadlineNotice(null);
        setWaitingForPrevious(false);setWaitingForPreviousStart(false);
        setError("The local test status could not be read here. Reloading inspects the same attempt; it does not start another.");
      }
      return;
    }
    observationController.current = controller;
    const ownsObservation = () => observationController.current === controller && !controller.signal.aborted;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function inspect() {
      if (!ownsObservation()) return;
      const priorStart = physicalStartRequest.current;
      if (priorStart) {
        const ownStart = pendingRequest.current;
        const startBelongsToVisit = pendingStartVisit.current === viewVisit.current;
        waitingObservation.current = inspect;
        setReading(true);
        setWaitingForPreviousStart(true);
        void priorStart.then(() => {
          if (waitingObservation.current === inspect && ownsObservation()) {
            waitingObservation.current = null;
            if (latestStatus.current === null && (!ownStart || ownStart.signal.aborted || !startBelongsToVisit)) void inspect();
            else { setWaitingForPreviousStart(false);setReading(false); }
          }
        });
        return;
      }
      setWaitingForPreviousStart(false);
      if (pendingRead.current) {
        waitingObservation.current = inspect;
        return;
      }
      const prior = physicalStatusRead.current;
      if (prior) {
        waitingObservation.current = inspect;
        setReading(true);
        setWaitingForPrevious(true);
        void prior.then(() => {
          if (waitingObservation.current === inspect && ownsObservation()) {
            waitingObservation.current = null;
            void inspect();
          }
        });
        return;
      }
      waitingObservation.current = null;
      setWaitingForPrevious(false);
      pendingRead.current = controller;setReading(true);setDeadlineNotice(null);
      let releaseOwnedRead = () => {};
      const settled = new Promise<void>(resolve => { releaseOwnedRead = resolve; });
      physicalStatusRead.current = settled;
      try {
        const read = requestPrivateCustodianStatus("GET", controller.signal, () => {
          if (pendingRead.current === controller && ownsObservation() && activeView.current) setDeadlineNotice("status");
        }, () => ownsObservation() && activeView.current);
        const next = await read;
        if (pendingRead.current !== controller || !ownsObservation() || !activeView.current) return;
        showStatus(next);setError(null);
        if (next.state === "running") timer = setTimeout(inspect, 1_000);
      } catch {
        if (pendingRead.current === controller && ownsObservation() && activeView.current) setError("The local test status could not be read. Reloading checks the same attempt; it does not start another.");
      } finally {
        releaseOwnedRead();
        if (physicalStatusRead.current === settled) physicalStatusRead.current = null;
        if (pendingRead.current === controller) {
          pendingRead.current = null;
          if (ownsObservation() && activeView.current) { setReading(false);setDeadlineNotice(null); }
          resumeWaitingObservation();
        }
      }
    }
    if (phase === "running") timer = setTimeout(inspect, 1_000);
    else void inspect();
    return () => {
      // Retire this observation context before a replacement effect is set up.
      // Its late notice/result cannot own or update the replacement context.
      if (waitingObservation.current === inspect) waitingObservation.current = null;
      if (observationController.current === controller) observationController.current = null;
      cancelLocalObservationRead(controller);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [phase]);

  useEffect(() => {
    activeView.current = true;
    setAdmittedVisit(++viewVisit.current);
    return () => { activeView.current = false;cancelLocalObservationRead(pendingRequest.current); };
  }, []);

  async function start() {
    if (!ownsView() || latestStatus.current?.state !== "idle" || pendingRequest.current !== null ||
      physicalStartRequest.current !== null || pendingRead.current !== null) return;
    let controller: AbortController;
    try { controller = new AbortController(); }
    catch {
      if (ownsView() && latestStatus.current?.state === "idle" && pendingRequest.current === null &&
          physicalStartRequest.current === null && pendingRead.current === null)
        setError("The invented test could not be started here. No start request was sent.");
      return;
    }
    pendingRequest.current = controller;
    pendingStartVisit.current = representedVisit;
    const ownsStart = () => ownsView() && pendingRequest.current === controller && !controller.signal.aborted;
    // Starting retires idle admission even if its observation effect reconnects.
    latestStatus.current = null;
    setSubmitting(true);setError(null);setDeadlineNotice(null);
    let settled: Promise<void> | null = null;
    let releaseOwnedStart = () => {};
    try {
      settled = new Promise<void>(resolve => { releaseOwnedStart = resolve; });
      physicalStartRequest.current = settled;
      const request = requestPrivateCustodianStatus("POST", controller.signal, () => {
        if (ownsStart()) setDeadlineNotice("start");
      }, ownsStart);
      const next = await request;
      if (ownsStart()) showStatus(next);
    } catch {
      if (ownsStart()) {
        setError("The start response could not be confirmed. Inspecting the recorded attempt before any further action.");
        showStatus(null);
      }
    } finally {
      releaseOwnedStart();
      if (settled !== null && physicalStartRequest.current === settled) physicalStartRequest.current = null;
      if (pendingRequest.current === controller) {
        pendingRequest.current = null;
        pendingStartVisit.current = null;
        if (activeView.current) {
          setSubmitting(false);
          setWaitingForPreviousStart(false);
          if (pendingRead.current === null) setDeadlineNotice(null);
        }
      }
    }
  }

  return (
    <section className="completion-results" aria-labelledby="private-test-heading">
      <div className="section-heading"><h2 id="private-test-heading">Try the collection path with sample answers</h2><span className="tag tag--caution">Local test</span></div>
      <p>Run the connected private test with invented answers. It saves one sample pair in a separate test database and private sample folder. No real source is contacted and nothing is published.</p>
      <button type="button" className="button button--primary" onClick={() => void start()} disabled={!admittedView || confirmedStatus?.state !== "idle" || submitting || reading || physicalStartRequest.current !== null}>Run the invented collection test</button>
      <div role="status" aria-live="polite" aria-atomic="true" aria-busy={reading || submitting}>
        {confirmedStatus === null && reading && <p>Reading the local test status…</p>}
        {waitingForPrevious && <p>The previous status read is still finishing. Reloading checks the same attempt; it does not start another.</p>}
        {waitingForPreviousStart && <p>The previous start request is still finishing. Its outcome is unconfirmed; the next status check will inspect the same attempt.</p>}
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
