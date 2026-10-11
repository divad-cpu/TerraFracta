"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FictionalUpdateRequestError, requestFictionalUpdate } from "../../src/fictional-update-request";
import type { FictionalUpdateResult, FictionalUpdateScenario } from "../../src/fictional-update-result";
import { updateRunReportSchema, type UpdateRunReport } from "../../src/update-run-report";
import { FictionalCandidate } from "./candidate";
import { FictionalHistory } from "./history";
import { FictionalComparison } from "./comparison";
import { fictionalOutcomeLabel as outcomeLabel, fictionalReasonLabel as reasonLabel } from "../../src/fictional-decision-labels";
import { observeClientError } from "../../src/client-error-diagnostics.ts";

export function UpdateOperation({ initialReport }: { initialReport: UpdateRunReport }) {
  const navigationId = useId();
  const [trigger, setTrigger] = useState<"manual" | "scheduled">("manual");
  const [scenario, setScenario] = useState<FictionalUpdateScenario>("standard");
  const [recordedResult, setResult] = useState<FictionalUpdateResult | null>(null);
  const [viewingSaved, setViewingSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("The saved example is shown below. Start a rehearsal to calculate a fresh result.");
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const executionPanel = useRef<HTMLDivElement | null>(null);
  const visit = useRef<object | null>(null), observation = useRef<FictionalUpdateResult | null>(null);
  const [owner, setOwner] = useState<object | null>(null);
  const [savedVisit, setSavedVisit] = useState<object | null>(null);
  const [navigationFailureVisit, setNavigationFailureVisit] = useState<object | null>(null);
  const currentSavedVisit = useRef<object | null>(null), reportedNavigationVisit = useRef<object | null>(null);
  const comparisonVisit = useRef(0), selectedComparisonVisit = comparisonVisit.current;
  const admitted = owner !== null && visit.current === owner;
  const result = admitted && observation.current === recordedResult ? recordedResult : null;
  const ownsVisit = () => admitted && visit.current === owner;
  const ownsComparison = () => ownsVisit() && controller.current === null && result !== null &&
    observation.current === result && comparisonVisit.current === selectedComparisonVisit;
  const ownsSavedVisit = () => ownsVisit() && controller.current === null && viewingSaved && result !== null &&
    observation.current === result && savedVisit !== null && currentSavedVisit.current === savedVisit;
  useEffect(() => {
    const current = {};
    visit.current = current; setOwner(current); observation.current = null; comparisonVisit.current++;
    currentSavedVisit.current = null; setSavedVisit(null);
    setResult(null); setViewingSaved(false); setError(null);
    setMessage("The saved example is shown below. Start a rehearsal to calculate a fresh result.");
    setBusy(controller.current !== null);
    return () => {
      if (visit.current !== current) return;
      visit.current = null; observation.current = null; currentSavedVisit.current = null; comparisonVisit.current++; controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!ownsSavedVisit()) return;
    let failed = false;
    try { executionPanel.current?.scrollIntoView({ behavior: "auto", block: "start" }); }
    catch { failed = true; }
    if (!ownsSavedVisit()) return;
    try { executionPanel.current?.focus({ preventScroll: true }); }
    catch { failed = true; }
    if (failed && ownsSavedVisit() && reportedNavigationVisit.current !== savedVisit) {
      reportedNavigationVisit.current = savedVisit;
      setNavigationFailureVisit(savedVisit);
      observeClientError("browser_runtime");
    }
  }, [result, viewingSaved, savedVisit]);
  const report = result?.report ?? initialReport;
  const checkedReport = updateRunReportSchema.safeParse(report);
  const draftIndex = checkedReport.success && checkedReport.data.fictionalCandidate
    ? checkedReport.data.items.findIndex(entry => entry.itemKey === checkedReport.data.fictionalCandidate?.itemKey) : -1;
  const draftId = `${navigationId}-draft`, originId = `${navigationId}-item-${draftIndex}`;
  const held = report.items.filter((entry) => entry.outcome === "held").length;
  const unchanged = report.items.filter((entry) => entry.outcome === "unchanged").length;

  async function run() {
    if (!ownsVisit() || busy || controller.current !== null) return;
    const active = new AbortController();
    comparisonVisit.current++;
    controller.current = active;
    currentSavedVisit.current = null; setSavedVisit(null);
    setBusy(true);
    setError(null);
    setMessage("Running the fictional source through the shared checks…");
    try {
      const fresh = await requestFictionalUpdate(trigger, scenario, active.signal, () => {
        if (visit.current === owner && controller.current === active && !active.signal.aborted)
          setMessage("The response deadline elapsed. The original request is still finishing; another rehearsal cannot start yet. A saved receipt may exist.");
      });
      if (visit.current !== owner || controller.current !== active || active.signal.aborted) return;
      observation.current = fresh; setResult(fresh);
      setViewingSaved(false);
      const count = fresh.report.items.filter((entry) => entry.outcome === "held").length;
      setMessage(`Rehearsal ${fresh.report.state === "completed" ? "finished" : "needs attention"}: ${fresh.report.items.length} items checked, ${count} held, zero published. Its fictional receipt is saved on this machine.`);
    } catch (failure) {
      if (visit.current !== owner || controller.current !== active || active.signal.aborted) return;
      const reason = failure instanceof FictionalUpdateRequestError ? failure.reason : "unconfirmed";
      if (reason === "unconfirmed") observeClientError("update_request");
      setError(reason === "busy" ? "A rehearsal is already running. Load recent runs after it finishes." :
        reason === "archive_full" ? "The local fictional archive is full. Existing results are preserved; its capacity needs attention before another receipt can be saved." :
        "The response could not be confirmed. A saved receipt may exist. Load recent runs before starting another rehearsal.");
      setMessage("No fresh result was confirmed. The previous result is still shown.");
    } finally {
      if (controller.current === active) {
        // Settlement retires callbacks captured while this physical slot was busy.
        comparisonVisit.current++;
        controller.current = null;
        // A successor receives availability, never this retired request's data.
        if (visit.current !== null) setBusy(false);
      }
    }
  }

  return (
    <>
      <section className="update-operation" aria-labelledby="operation-heading" aria-busy={busy}>
        <div><p className="eyebrow">Try the shared operation</p><h2 id="operation-heading">Run a fictional update</h2><p>One local source fixture, four items, zero model calls. The weekly option exercises the accepted Monday 08:00 Oslo window.</p></div>
        <form onSubmit={(event) => { event.preventDefault(); void run(); }}>
          <fieldset disabled={!admitted || busy}>
            <legend>Start the rehearsal as</legend>
            <label><input type="radio" name="trigger" value="manual" checked={trigger === "manual"} onChange={() => { if (ownsVisit() && controller.current === null) setTrigger("manual"); }} /> Manual update</label>
            <label><input type="radio" name="trigger" value="scheduled" checked={trigger === "scheduled"} onChange={() => { if (ownsVisit() && controller.current === null) setTrigger("scheduled"); }} /> Weekly update rehearsal</label>
          </fieldset>
          <label className="update-operation__example">Choose a rehearsal example
            <select value={scenario} disabled={!admitted || busy} onChange={(event) => { if (ownsVisit() && controller.current === null) setScenario(event.target.value as typeof scenario); }}>
              <option value="standard">Changed, held and unchanged items</option>
              <option value="missing_source">Expected source is missing</option>
              <option value="invalid_citation">One source link fails the checks</option>
              <option value="revised_value">A source revises 27.4% to 28.1%</option>
            </select>
          </label>
          <button className="button button--primary" type="submit" disabled={!admitted || busy}>{busy ? "Checking…" : "Run fictional update"}</button>
        </form>
        <p className="update-operation__status" role="status">{message}</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <p className="update-operation__limit">This runs now and saves a fictional receipt on this machine. It does not install a schedule, fetch a source or publish information.</p>
      </section>
      {ownsSavedVisit() && navigationFailureVisit === savedVisit && <p className="info-band" role="status">
        The saved run is ready below. Automatic navigation was unavailable. <a href="#selected-rehearsal-execution">Read the selected run</a>.
      </p>}
      {result && <div id="selected-rehearsal-execution" className="update-execution" ref={executionPanel} tabIndex={-1}><strong>{viewingSaved ? "Saved local execution" : "Fresh local execution"}</strong><p><time dateTime={result.execution.executedAt}>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "medium", timeZone: "Europe/Oslo" }).format(new Date(result.execution.executedAt))}</time> Oslo · {result.execution.durationMs} ms. The source dates below belong to the fictional fixture.</p><details><summary>Local execution reference</summary><code>{result.execution.id}</code></details></div>}
      <div className="desk-grid update-report-summary">
        <article><p className="eyebrow">{result ? "Calculated result" : "Saved example"}</p><h2>{report.state === "completed" ? "Rehearsal finished" : "Rehearsal needs attention"}</h2><p>Fictional country. {report.trigger === "manual" ? "Manual trigger" : "Weekly trigger rehearsal"}. Public changes: {report.publicChanges}.</p>{report.scheduledDueAt && <p>Fixture window: Monday 08:00 Europe/Oslo (<time dateTime={report.scheduledDueAt}>{report.scheduledDueAt}</time>).</p>}<details><summary>Fixture request identity</summary><code>{report.requestKey}</code></details></article>
        <article><p className="eyebrow">Work found</p><h2>{report.items.length} checked · {held} held</h2><p>{report.coveredSourceKeys.length} of {report.dueSourceKeys.length} expected fictional sources covered. {unchanged} unchanged item. Held findings remain visible without being published.</p>{report.coveredSourceKeys.length < report.dueSourceKeys.length && <p><strong>A missing or unverified source keeps this run incomplete.</strong></p>}</article>
      </div>
      <section className="update-report" aria-labelledby="update-report-heading">
        <div className="section-heading"><div><p className="eyebrow">Decision trace</p><h2 id="update-report-heading">What happened to each item</h2></div><span className="section-index">FICTIONAL RUN</span></div>
        <ol className="update-report__items">
          {report.items.map((entry, index) => <li key={entry.itemKey} id={index === draftIndex ? originId : undefined} className="update-report__item">
            <div><p className="eyebrow">{entry.itemKey}</p><h3>{outcomeLabel[entry.outcome] ?? "Further checks required"}</h3><p>{entry.reasonCodes.map((code) => reasonLabel[code] ?? "Additional review is required.").join(" ")}</p><details><summary>Decision codes</summary><p>{entry.reasonCodes.map((code, index) => <code key={code}>{index > 0 && ", "}{code}</code>)}</p></details></div>
            <div className="update-report__source">{entry.source === null
              ? <><strong>Source details withheld</strong><span>This reference failed the checks. No address or locator is offered.</span></>
              : <><strong>{entry.source.title}</strong><span>{entry.source.publisher}</span><a href={entry.source.url}>Illustrative source address</a><span>Exact location: <code>{entry.source.locator}</code></span><details><summary>Source version</summary><code>{entry.source.sourceVersionId}</code></details></>}
            {!entry.sourceBindingValid && <strong>Source coverage is incomplete</strong>}</div>
            {index === draftIndex && <p><a href={`#${draftId}`}>Inspect this item’s checked draft</a></p>}
          </li>)}
        </ol>
        {report.items.length === 0 && <p>No source items were checked in this rehearsal. The expected source remains uncovered.</p>}
      </section>
      {result?.execution.scenario === "revised_value" && initialReport.fictionalCandidate && report.fictionalCandidate &&
        <FictionalComparison key={`${result.execution.id}:${selectedComparisonVisit}`} baseline={initialReport.fictionalCandidate} candidate={report.fictionalCandidate} isCurrent={ownsComparison} />}
      {report.fictionalCandidate && (draftIndex >= 0
        ? <div id={draftId}><FictionalCandidate candidate={report.fictionalCandidate} /><p><a href={`#${originId}`}>Return to checked item {draftIndex + 1}</a></p></div>
        : <FictionalCandidate candidate={report.fictionalCandidate} />)}
      <FictionalHistory inspectionDisabled={!admitted || busy} onInspect={(saved) => {
        if (!ownsVisit() || busy || controller.current !== null) return;
        comparisonVisit.current++;
        const current = {}; currentSavedVisit.current = current; setSavedVisit(current);
        observation.current = saved; setResult(saved); setViewingSaved(true); setError(null);
        setMessage("A saved fictional result is shown below. Start a rehearsal to calculate a fresh result.");
      }} />
    </>
  );
}
