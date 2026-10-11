import { heldBrowseHref } from "./operator-held-browse.ts";
import { auditRunReturnParams } from "./operator-audit-navigation.ts";
import { OperatorWorkspaceNavigation } from "./operator-workspace-navigation-view.tsx";
import { PageIntro } from "../app/components";
import { operatorAuditChoicesSchema, type OperatorAuditChoices, type OperatorAuditRunCursor } from "./operator-audit-choices.ts";
import { canonicalOperatorAuditChoice, canonicalOperatorAuditRunCursor, type OperatorAuditChoicesDecision } from "./server/operator-audit-choices-reader.ts";

const selectPath = "/editorial-preview/audit/select";
const labels = {
  invalid_scope: ["Choose a recorded run", "The selection is invalid. No records were read."],
  unconfigured: ["Recorded run connection unavailable", "The private record connection is not configured. No runs or issues have been inspected."],
  unavailable: ["Recorded choices unavailable", "The records could not be checked. All choices are withheld; this is not an empty or healthy result."],
  changed: ["Recorded run list changed", "The continuation reference no longer resolves to the same recorded run time. This page is withheld; start again with the newest runs."],
} as const;
const states = { queued: "Queued", running: "Running", completed: "Completed", partial: "Partial", failed: "Failed", rejected: "Rejected" } as const;

function selectionLink(runId: string | null, cursor: OperatorAuditRunCursor | null): string {
  const query = new URLSearchParams();
  if (runId !== null) query.set("runId", runId);
  if (cursor !== null) { query.set("beforeCreatedAt", cursor.createdAt); query.set("beforeRunId", cursor.runId); }
  return query.size === 0 ? selectPath : `${selectPath}?${query}`;
}

function Choices({ report }: { report: OperatorAuditChoices }) {
  const selected = report.selectedRun;
  return <>
    <p>Records observed (UTC): <time dateTime={report.observedAt}>{report.observedAt}</time>. Stored states do not establish current source health, publication eligibility or public visibility.</p>
    <section aria-labelledby="recorded-runs-heading">
      <h2 id="recorded-runs-heading">{report.requestedCursor === null ? "Recent recorded runs" : "Older recorded runs"}</h2>
      {report.runs.length === 0 ? <div className="empty-state"><h3>No recorded runs returned</h3><p>This checked overview is empty. It does not establish successful updates or current source health.</p></div> :
        <ol className="current-source-list" aria-label={report.requestedCursor === null ? "Recent recorded runs" : "Older recorded runs"}>{report.runs.map(run => <li key={run.runId}><article>
          <h3><a href={selectionLink(run.runId, report.requestedCursor)} aria-current={run.runId === selected?.runId ? "true" : undefined}>
            {run.jurisdictionId} · <time dateTime={run.createdAt}>{run.createdAt}</time>
          </a></h3>
          <p>Stored run state: {states[run.runState]}</p>
          <details><summary>Run reference</summary><code>{run.runId}</code></details>
        </article></li>)}</ol>}
      <nav className="current-issue-nav" aria-label="Recorded run pages">
        {report.nextCursor !== null && <a href={selectionLink(report.requestedRunId, report.nextCursor)}>Older recorded runs</a>}
        {report.requestedCursor !== null && <a href={selectionLink(report.requestedRunId, null)}>Newest recorded runs</a>}
      </nav>
      <p>{report.moreRuns ? "This page shows 20 runs. More older recorded runs are available." : "No older continuation was returned for this checked page."}</p>
      <p>Each page makes a new read. Newer runs and changed stored states may appear when the newest page is refreshed.</p>
    </section>
    <section aria-labelledby="recorded-issues-heading">
      <h2 id="recorded-issues-heading">Choose an issue for the selected run</h2>
      {report.requestedRunId === null ? <p>Choose a run above to see issue choices for its jurisdiction.</p> : selected === null ?
        <div className="empty-state"><h3>No matching recorded run</h3><p>No run was returned for this checked selection. No issue choices are supplied.</p></div> : <>
          <p><a href={heldBrowseHref({ runId: selected.runId, cursor: null }, "", { runId: selected.runId, cursor: report.requestedCursor })}>Inspect held decisions for this run</a></p>
          <p>Selected: {selected.jurisdictionId} · <time dateTime={selected.createdAt}>{selected.createdAt}</time>. Stored run state: {states[selected.runState]}.</p>
          <p>These are issue dossiers in this run&apos;s jurisdiction. Their presence does not mean this run updated or published them.</p>
          {report.issues.length === 0 ? <div className="empty-state"><h3>No issue dossiers returned</h3><p>The checked selection has no issue choices. No publication or coverage outcome follows.</p></div> :
            <form method="get" action="/editorial-preview/audit" className="current-source-filters" aria-label="Open an audit for the selected run">
              <input type="hidden" name="runId" value={selected.runId} />
              {Object.entries(auditRunReturnParams({ runId: selected.runId, cursor: report.requestedCursor })).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
              <div><label htmlFor="recorded-audit-issue">Issue</label><select id="recorded-audit-issue" name="issueId" required aria-describedby="recorded-issue-hint">
                {report.issues.map(issue => <option key={issue.issueId} value={issue.issueId}>{issue.issueKey.replaceAll("-", " ")}</option>)}
              </select></div>
              <button type="submit">Inspect recorded audit</button>
              <p id="recorded-issue-hint">Labels come from stored issue keys. The audit makes a new read of the selected run and issue.</p>
            </form>}
          <p>{report.moreIssues ? "Only the first 50 issue keys are shown. More dossiers exist; an exact reference can still be used in the audit form." : "All issue choices for this checked selection are listed."}</p>
        </>}
    </section>
  </>;
}

// Validate the direct presentation seam too; unchecked data never creates links
// or controls. There is no browser-local record store or client fetch.
export function OperatorAuditChoicesView({ decision, selection, cursor }: {
  decision: OperatorAuditChoicesDecision; selection?: string | null; cursor?: OperatorAuditRunCursor | null;
}) {
  let report: OperatorAuditChoices | null = null;
  let held: keyof typeof labels = "unavailable";
  let selectedRun: string | null | undefined;
  let selectedCursor: Readonly<OperatorAuditRunCursor> | null | undefined;
  try {
    if (decision.kind !== "invalid_scope") {
      selectedRun = canonicalOperatorAuditChoice(selection ?? null);
      selectedCursor = canonicalOperatorAuditRunCursor(cursor ?? null);
    }
    if (decision.kind === "ok") {
      const checked = operatorAuditChoicesSchema.safeParse(decision.report);
      if (checked.success && (selection === undefined || selectedRun === checked.data.requestedRunId) &&
        (cursor === undefined || selectedCursor !== undefined && JSON.stringify(selectedCursor) === JSON.stringify(checked.data.requestedCursor))) report = checked.data;
    } else if (Object.hasOwn(labels, decision.kind)) held = decision.kind;
  } catch { /* Details from unchecked input are withheld. */ }
  // Reuse the same independently checked selection for detail-free recovery;
  // the withheld report never supplies scope or an older-page continuation.
  const recoveryRun = held !== "invalid_scope" && selectedCursor !== undefined ? selectedRun ?? null : null;
  const context = report === null ? (recoveryRun ? { runId: recoveryRun } : {}) :
    report.selectedRun ? { runId: report.selectedRun.runId } : {};
  const [title, explanation] = labels[held];
  return <div className="content-page">
    <PageIntro eyebrow="Development only / Recorded operator audit" title="Choose a recorded run and issue">
      <p>Open the existing source-check and publication history audit from stored records. This overview has no collection, approval, editing or publication control.</p>
    </PageIntro>
    <OperatorWorkspaceNavigation active="runs" context={context} />
    {report === null ? <section className="info-band" role="status"><h2>{title}</h2><p>{explanation}</p><a href={selectionLink(recoveryRun, null)}>Refresh recorded choices</a></section> : <Choices report={report} />}
    <nav className="current-issue-nav" aria-label="Editorial workspace">
      <a href="/editorial-preview/audit">Use exact run and issue references</a>
      <a href="/editorial-preview">Back to the review desk</a>
    </nav>
  </div>;
}
