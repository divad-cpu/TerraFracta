import { matchingRecordedIssueChoices, recordedIssueQuery } from "./recorded-issue-choice-search.ts";
import { heldBrowseHref } from "./operator-held-browse.ts";
import { auditRunStateFilter, auditRunStates, type AuditRunStateFilter, auditRunReturnParams } from "./operator-audit-navigation.ts";
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

function selectionLink(runId: string | null, cursor: OperatorAuditRunCursor | null, state: AuditRunStateFilter = "", issueQuery = ""): string {
  const query = new URLSearchParams();
  if (runId !== null) query.set("runId", runId);
  if (cursor !== null) { query.set("beforeCreatedAt", cursor.createdAt); query.set("beforeRunId", cursor.runId); }
  if (state) query.set("state", state);
  if (issueQuery) query.set("issueQ", issueQuery);
  return query.size === 0 ? selectPath : `${selectPath}?${query}`;
}

function Choices({ report, state, issueQuery }: { report: OperatorAuditChoices; state: AuditRunStateFilter; issueQuery: string }) {
  const selected = report.selectedRun;
  const issues = matchingRecordedIssueChoices(report.issues, issueQuery);
  const labelCounts = new Map<string, number>();
  const choiceLabel = (key: string) => key.replaceAll("-", " ");
  const collapsedLabel = (key: string) => choiceLabel(key).replace(/\s+/gu, " ").trim();
  for (const issue of issues) {
    const label = collapsedLabel(issue.issueKey);
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }

  const runs = report.runs.filter(run => !state || run.runState === state);
  const runReturn = selected === null ? null : { runId: selected.runId, cursor: report.requestedCursor, ...(state ? { state } : {}), ...(issueQuery ? { issueQuery } : {}) };
  return <>
    <p>Records observed (UTC): <time dateTime={report.observedAt}>{report.observedAt}</time>. Stored states do not establish current source health, publication eligibility or public visibility.</p>
    <section aria-labelledby="recorded-runs-heading">
      <h2 id="recorded-runs-heading">{report.requestedCursor === null ? "Recent recorded runs" : "Older recorded runs"}</h2>
      <form action={selectPath} method="get" className="current-source-filters" aria-label="Filter recorded run states">
        {report.requestedRunId && <input type="hidden" name="runId" value={report.requestedRunId} />}
        {report.requestedCursor && <><input type="hidden" name="beforeCreatedAt" value={report.requestedCursor.createdAt} /><input type="hidden" name="beforeRunId" value={report.requestedCursor.runId} /></>}
        {issueQuery && <input type="hidden" name="issueQ" value={issueQuery} />}
        <div><label htmlFor="recorded-run-state">Stored run state on this page</label><select id="recorded-run-state" name="state" defaultValue={state} aria-describedby="recorded-run-state-help"><option value="">All recorded states</option>{auditRunStates.map(value => <option key={value} value={value}>{states[value]}</option>)}</select></div>
        <button type="submit">Apply run state filter</button><a href={selectionLink(report.requestedRunId, report.requestedCursor, "", issueQuery)}>Clear run state filter</a>
        <p id="recorded-run-state-help">This filters only this checked run page. Every link or submission makes a new read; stored states do not establish current source health or publication success.</p>
      </form>
      <p role="status">Showing {runs.length} of {report.runs.length} recorded runs on this checked page.</p>
      {report.runs.length === 0 ? <div className="empty-state"><h3>No recorded runs returned</h3><p>This checked overview is empty. It does not establish successful updates or current source health.</p></div> : runs.length === 0 ? <div className="empty-state"><h3>No matching stored run state on this page</h3><p>Other pages may contain matches. No successful update or absence of failed runs elsewhere follows.</p></div> :
        <ol className="current-source-list" aria-label={report.requestedCursor === null ? "Recent recorded runs" : "Older recorded runs"}>{runs.map(run => <li key={run.runId}><article>
          <h3><a href={selectionLink(run.runId, report.requestedCursor, state, issueQuery)} aria-current={run.runId === selected?.runId ? "true" : undefined}>
            {run.jurisdictionId} · <time dateTime={run.createdAt}>{run.createdAt}</time>
          </a></h3>
          <p>Stored run state: {states[run.runState]}</p>
          <details><summary>Run reference</summary><code>{run.runId}</code></details>
        </article></li>)}</ol>}
      <nav className="current-issue-nav" aria-label="Recorded run pages">
        {report.nextCursor !== null && <a href={selectionLink(report.requestedRunId, report.nextCursor, state, issueQuery)}>Older recorded runs</a>}
        {report.requestedCursor !== null && <a href={selectionLink(report.requestedRunId, null, state, issueQuery)}>Newest recorded runs</a>}
      </nav>
      <p>{report.moreRuns ? "This checked page contains 20 stored runs before filtering. More older recorded runs are available." : "No older continuation was returned for this checked page."}</p>
      <p>Each page makes a new read. Newer runs and changed stored states may appear when the newest page is refreshed.</p>
    </section>
    <section aria-labelledby="recorded-issues-heading">
      <h2 id="recorded-issues-heading">Choose an issue for the selected run</h2>
      {report.requestedRunId === null ? <p>Choose a run above to see issue choices for its jurisdiction.</p> : selected === null ?
        <div className="empty-state"><h3>No matching recorded run</h3><p>No run was returned for this checked selection. No issue choices are supplied.</p></div> : <>
          <p><a href={heldBrowseHref({ runId: selected.runId, cursor: null }, "", runReturn)}>Inspect held decisions for this run</a></p>
          <p>Selected: {selected.jurisdictionId} · <time dateTime={selected.createdAt}>{selected.createdAt}</time>. Stored run state: {states[selected.runState]}.</p>
          {state && selected.runState !== state && <p role="note">The separately checked selected run does not match this page’s run state filter. Its issue choices remain available.</p>}
          <details><summary>Selected recorded run reference</summary><code>{selected.runId}</code></details>
          <p>These are issue dossiers in this run&apos;s jurisdiction. Their presence does not mean this run updated or published them.</p>
          <form method="get" action={selectPath} className="current-source-filters" aria-label="Find a checked issue choice">
            <input type="hidden" name="runId" value={selected.runId} />
            {report.requestedCursor && <><input type="hidden" name="beforeCreatedAt" value={report.requestedCursor.createdAt} /><input type="hidden" name="beforeRunId" value={report.requestedCursor.runId} /></>}
            {state && <input type="hidden" name="state" value={state} />}
            <div><label htmlFor="recorded-issue-query">Issue key or reference in these choices</label><input id="recorded-issue-query" name="issueQ" type="search" maxLength={80} defaultValue={issueQuery} aria-describedby="recorded-issue-search-help" /></div>
            <button type="submit">Find issue choices</button><a href={selectionLink(selected.runId, report.requestedCursor, state)}>Clear issue search</a>
            <p id="recorded-issue-search-help">Every word must match this same returned issue key, its displayed label or its exact reference. A match does not establish publication or source coverage. Submitting checks the selected run again.</p>
          </form>
          <p role="status">Showing {issues.length} of {report.issues.length} checked issue choices.</p>
          {issues.length > 0 && <details className="reader-recovery" aria-label="Checked matching issue references">
            <summary>Inspect matching issue keys and references</summary>
            <p>These are the checked choices in this selection, in stored key order. Use an exact reference in the issue search to distinguish similar labels. A listed reference does not mean this run updated or published its dossier.</p>
            <ol>{issues.map(issue => <li key={issue.issueId}><dl>
              <div><dt>Stored issue key</dt><dd><code>{issue.issueKey}</code></dd></div>
              <div><dt>Exact issue reference</dt><dd><code>{issue.issueId}</code></dd></div>
            </dl></li>)}</ol>
          </details>}

          {report.issues.length === 0 ? <div className="empty-state"><h3>No issue dossiers returned</h3><p>The checked selection has no issue choices. No publication or coverage outcome follows.</p></div> : issues.length === 0 ? <div className="empty-state"><h3>No matching issue key on this checked selection</h3><p>Other dossiers may exist outside these returned choices. A missing match does not establish absence of an issue, source or publication.</p></div> :
            <form method="get" action="/editorial-preview/audit" className="current-source-filters" aria-label="Open an audit for the selected run">
              <input type="hidden" name="runId" value={selected.runId} />
              {Object.entries(auditRunReturnParams(runReturn)).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
              <div><label htmlFor="recorded-audit-issue">Issue</label><select id="recorded-audit-issue" name="issueId" required aria-describedby="recorded-issue-hint">
                {issues.map(issue => <option key={issue.issueId} value={issue.issueId}>{choiceLabel(issue.issueKey)}{(labelCounts.get(collapsedLabel(issue.issueKey)) ?? 0) > 1 ? ` · ${issue.issueKey}` : ""}</option>)}
              </select></div>
              <button type="submit">Inspect recorded audit</button>
              <p id="recorded-issue-hint">Labels come from stored issue keys. The audit makes a new read of the selected run and issue.</p>
            </form>}
          <p>{report.moreIssues ? "Only the first 50 issue keys were returned before searching. More dossiers exist; an exact reference can still be used in the audit form." : issueQuery ? "All returned issue choices were searched. Clearing the search lists them again." : "All issue choices for this checked selection are listed."}</p>
        </>}
    </section>
  </>;
}

// Validate the direct presentation seam too; unchecked data never creates links
// or controls. There is no browser-local record store or client fetch.
export function OperatorAuditChoicesView({ decision, selection, cursor, state, issueQuery }: {
  decision: OperatorAuditChoicesDecision; selection?: string | null; cursor?: OperatorAuditRunCursor | null; state?: unknown; issueQuery?: unknown;
}) {
  const filter = auditRunStateFilter(state);
  const issueFilter = recordedIssueQuery(issueQuery);
  let report: OperatorAuditChoices | null = null;
  let held: keyof typeof labels = "unavailable";
  let selectedRun: string | null | undefined;
  let selectedCursor: Readonly<OperatorAuditRunCursor> | null | undefined;
  try {
    if (filter === null || issueFilter === null) held = "invalid_scope";
    else {
    if (decision.kind !== "invalid_scope") {
      selectedRun = canonicalOperatorAuditChoice(selection ?? null);
      selectedCursor = canonicalOperatorAuditRunCursor(cursor ?? null);
    }
    if (decision.kind === "ok") {
      const checked = operatorAuditChoicesSchema.safeParse(decision.report);
      if (checked.success && (selection === undefined || selectedRun === checked.data.requestedRunId) &&
        (cursor === undefined || selectedCursor !== undefined && JSON.stringify(selectedCursor) === JSON.stringify(checked.data.requestedCursor))) report = checked.data;
    } else if (Object.hasOwn(labels, decision.kind)) held = decision.kind;
    }
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
    {report === null ? <section className="info-band" role="status"><h2>{title}</h2><p>{explanation}</p><a href={selectionLink(recoveryRun, null, filter ?? "", issueFilter ?? "")}>Refresh recorded choices</a></section> : <Choices report={report} state={filter ?? ""} issueQuery={issueFilter ?? ""} />}
    <nav className="current-issue-nav" aria-label="Editorial workspace">
      <a href="/editorial-preview/audit">Use exact run and issue references</a>
      <a href="/editorial-preview">Back to the review desk</a>
    </nav>
  </div>;
}
