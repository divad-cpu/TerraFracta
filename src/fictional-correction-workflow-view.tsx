import type { FictionalWorkflowState } from "./fictional-correction-workflow.ts";

const messages = {
  unavailable: "The local result could not be checked. Earlier detail is withheld.",
  invalid_action: "This step is not available in the current workflow state.",
  changed: "The current fictional publication changed. Prepare against a fresh read.",
  invalid_draft: "Only the fixed authored fictional report can enter this exercise.",
  not_dispatched: "This command was not dispatched. No storage is claimed.",
  unknown_intake: "Intake outcome is unknown. Its immutable request identity is retained. There is no read-only intake recovery operation; no automatic retry follows.",
  unknown_review: "Review outcome is unknown. Its immutable event identity is retained. Use read-only event recovery after the owned action settles.",
  not_observed: "The review event was not observed. This read does not prove that a write can safely be repeated.",
  cancelled: "The read was cancelled. Earlier detail is withheld.",
} as const;
export type FictionalWorkflowActions = {
  load: () => void; preparePage: () => void; prepareStatement: () => void; submit: () => void;
  queue: () => void; nextPage: () => void; detail: () => void; startReview: () => void;
  closeReview: () => void; recover: () => void; cancel: () => void;
};

// Exact fixed-local workflow only. No arbitrary explanation/contact/upload or
// user-selected backend enters this presenter. Observations and receipts stay separate.
export function FictionalCorrectionWorkflowView({ state, actions }: { state: FictionalWorkflowState; actions?: FictionalWorkflowActions }) {
  const held = state.phase === "held" || state.phase === "disposed";
  const writeResolved = state.uncertainWrite === null;
  const editable = writeResolved && !held && !state.busy && !state.intake && !!state.issue;
  const ownMember = state.queue?.items.some(item => item.reportId === state.intake?.reportId) ?? false;
  const control = (label: string, action: keyof FictionalWorkflowActions, enabled: boolean) =>
    <button type="button" disabled={!actions || state.busy || state.phase === "unconfigured" || state.phase === "disposed" || !enabled} onClick={actions?.[action]}>{label}</button>;
  return <section className="fictional-correction-workflow" aria-labelledby="fictional-workflow-heading" aria-busy={state.busy}>
    <header><p className="eyebrow">Private development / One controlled fictional report</p><h2 id="fictional-workflow-heading">Follow a correction through review</h2>
      <p>This exercise uses fixed invented wording and the existing local contracts. A report cannot change a fact or publication. It has no operational account, free-text collection or default backend.</p></header>
    <p role="status" aria-live="polite">{state.phase === "unconfigured" ? "Local workflow connection unavailable. No report was sent or saved." : state.busy ? "One owned action is pending. Other actions are unavailable." : `Workflow state: ${state.phase.replaceAll("_", " ")}.`}</p>
    {state.reason && <div className="info-band" role="status"><h3>Step held</h3><p>{messages[state.reason]}</p></div>}
    {state.phase === "held" && state.uncertainWrite === "review" && ["unavailable", "cancelled"].includes(state.reason ?? "") &&
      <p>Review outcome remains unknown. After the owned action settles, look up the same event again. This is a read-only check; no review command is repeated.</p>}
    {state.executionId && <details><summary>Same-execution references</summary><dl>
      <div><dt>Execution</dt><dd><code>{state.executionId}</code></dd></div>
      {state.request && <div><dt>Intake request</dt><dd><code>{state.request.requestId}</code></dd></div>}
      {state.intake && <div><dt>Recorded report</dt><dd><code>{state.intake.reportId}</code></dd></div>}
      {state.reviewRequest && <div><dt>Review event</dt><dd><code>{state.reviewRequest.eventId}</code></dd></div>}
    </dl></details>}
    {!held && state.issue && <div className="workflow-draft"><h3>1. Current fictional target and fixed draft</h3><p>{state.issue.title} · revision {state.issue.revision}. Evidence review: <time dateTime={state.issue.lastEvidenceReviewOn}>{state.issue.lastEvidenceReviewOn}</time>.</p>
      {state.request && <><p>Target: {state.request.draft.target.claimId === null ? "Complete page" : "Exact visible statement"}.</p><p>{state.request.draft.fields.details}</p><p>Source address (not fetched): {state.request.draft.fields.sourceUrl}</p><p>Prepared in memory. A request identity does not prove delivery.</p></>}
    </div>}
    {!held && state.intake && <section><h3>2. Confirmed private intake receipt</h3><p>The adapter confirmed storage for this request, publication revision {state.intake.revision}. Report review and public content remain separate.</p></section>}
    {!held && state.queue && <section><h3>3. Bounded private queue</h3><p>Observed: <time dateTime={state.queue.observedAt}>{state.queue.observedAt}</time>. Captured: <time dateTime={state.queue.capturedAt}>{state.queue.capturedAt}</time>. Expires: <time dateTime={state.queue.expiresAt}>{state.queue.expiresAt}</time>.</p>
      <p>Page membership is frozen; review states are observed separately on each page. Showing {state.queue.items.length} of {state.queue.total} members.</p>
      {state.queue.items.length ? <ul>{state.queue.items.map(item => <li key={item.reportId}>Recorded report <code>{item.reportId}</code> · observed state {item.reviewState.replaceAll("_", " ")}{item.reportId === state.intake?.reportId ? " · This workflow’s report" : " · Another queue member; not selected by this exercise"}</li>)}</ul> : <p>This checked page is empty. Missing access would be a held result instead.</p>}
    </section>}
    {!held && state.detail && <section><h3>4. Last checked report detail</h3><p>{state.detail.draft.fields.details}</p><p>Last observed review state: <strong>{state.detail.report.reviewState.replaceAll("_", " ")}</strong>. Reported: <time dateTime={state.detail.report.reportedAt}>{state.detail.report.reportedAt}</time>.</p>
      <ol>{state.detail.report.events.map(event => <li key={event.sequence}>Event {event.sequence}: {event.fromState.replaceAll("_", " ")} → {event.toState.replaceAll("_", " ")} · <time dateTime={event.recordedAt}>{event.recordedAt}</time></li>)}</ol>
    </section>}
    {!held && state.reviewReceipt && <section><h3>5. Confirmed historical review event</h3><p>Event {state.reviewReceipt.sequence}: {state.reviewReceipt.fromState.replaceAll("_", " ")} → {state.reviewReceipt.toState.replaceAll("_", " ")} · <time dateTime={state.reviewReceipt.recordedAt}>{state.reviewReceipt.recordedAt}</time>.</p><p>This receipt describes its stored transition. Read report detail again to observe its later review state.</p></section>}
    {state.recovery && (!held || state.phase === "held" && state.reason === "not_observed") && <section><h3>Read-only event recovery</h3><p>Outcome: {state.recovery.outcome.replaceAll("_", " ")}. Separately observed review state: {state.recovery.current.reviewState.replaceAll("_", " ")}.</p><p>A recovered earlier event does not reopen a closed report or authorize a repeated command. No public content changed.</p></section>}
    <div className="workflow-actions" role="group" aria-label="Controlled fictional workflow steps">
      {control("Read the current fictional target", "load", writeResolved && !state.intake && (["idle", "ready", "prepared"].includes(state.phase) || state.phase === "held"))}
      {control("Prepare the fixed page report", "preparePage", editable)}{control("Prepare the fixed statement report", "prepareStatement", editable)}
      {control("Send the fixed fictional request", "submit", writeResolved && state.phase === "prepared")}
      {control("Read a fresh queue snapshot", "queue", writeResolved && !!state.intake)}
      {control("Read the next queue page", "nextPage", writeResolved && !held && !!state.queue?.next)}
      {control("Read this report's detail", "detail", writeResolved && !held && ownMember && ["queued", "detail", "reviewed", "recovered"].includes(state.phase))}
      {control("Start the private review", "startReview", writeResolved && state.phase === "detail" && state.detail?.report.reviewState === "new")}
      {control("Close the technical exercise", "closeReview", writeResolved && state.phase === "detail" && state.detail?.report.reviewState === "in_review")}
      {control("Look up the uncertain review event", "recover", state.uncertainWrite === "review" && !!state.reviewRequest && !!state.intake)}
      {actions && state.busy && <button type="button" onClick={actions.cancel}>Cancel waiting</button>}
    </div>
  </section>;
}
