import { auditSourceQuery, matchingAuditSourceRows } from "./operator-audit-source-search.ts";
import { auditPublicationKindFilter, auditPublicationKinds, type AuditPublicationKindFilter, auditSourceRegistrationFilter, auditSourceRegistrationStates, type AuditSourceRegistrationFilter, auditSourceOutcomeFilter, auditSourceOutcomes, type AuditSourceOutcomeFilter, auditBrowseHref, auditRunReturnHref, auditRunReturnParams, canonicalAuditRunReturn, type OperatorAuditRunReturn } from "./operator-audit-navigation.ts";
import { OperatorWorkspaceNavigation } from "./operator-workspace-navigation-view.tsx";
import { PageIntro } from "../app/components";
import { operatorAuditReportSchema, operatorAuditScopeSchema, type OperatorAuditReport, type OperatorAuditScope } from "./operator-audit-report.ts";
import type { OperatorAuditReadDecision } from "./server/operator-audit-reader.ts";

const auditPath = "/editorial-preview/audit";
const heldLabels = {
  invalid_scope: ["Choose a recorded run and issue", "Enter exact run and issue UUIDs. An invalid selection is not read; extra selectors and incomplete history cursors are refused."],
  unconfigured: ["Recorded audit connection unavailable", "The audit provider is not configured. No records have been inspected, and no operational account is connected."],
  unavailable: ["Recorded audit unavailable", "The selected records could not be checked. All report details are withheld; this is not an empty or healthy result."],
  not_found: ["No matching recorded audit", "The selected run and issue did not resolve to one audit scope. No source or publication details are shown."],
  changed: ["Publication ledger changed", "The newest revision or stored head changed since this history page was selected. Start a fresh audit before continuing; the older page is withheld."],
} as const;
const registrationLabels = { candidate: "Candidate", approved: "Approved", suspended: "Suspended", retired: "Retired" } as const;
const outcomeLabels = { captured: "Captured", unchanged: "Unchanged", failed: "Failed", deferred: "Deferred", not_recorded: "No check recorded" } as const;
const publicationLabels = { draft: "Draft", accepted: "Accepted", correction: "Correction", suppression: "Suppression" } as const;
const runLabels = { queued: "Queued", running: "Running", completed: "Completed", partial: "Partial", failed: "Failed", rejected: "Rejected" } as const;
const commitLabels = { none: "No commit recorded", committed: "Committed", partial: "Partial commit" } as const;
const visibilityLabels = { not_required: "Not required by this run", pending: "Pending", verified: "Verified receipt", failed: "Failed receipt", mixed: "Mixed receipts" } as const;
const stamp = (value: string | null) => value === null ? "Not recorded" : <time dateTime={value}>{value}</time>;

function RecordedCountLinks({ label, entries }: { label: string; entries: ReadonlyArray<{ label: string; count: number; href: string; selected: boolean }> }) {
  return <nav className="current-issue-nav" aria-label={label}>{entries.map(entry => entry.count > 0
    ? <a key={entry.label} href={entry.href} aria-current={entry.selected ? "true" : undefined}>{entry.label}: {entry.count}</a>
    : <span key={entry.label}>{entry.label}: 0</span>)}</nav>;
}

function RecordedAudit({ report, runReturn, outcome, publicationKind, sourceQuery, registrationState }: { report: OperatorAuditReport; runReturn: OperatorAuditRunReturn | null; outcome: AuditSourceOutcomeFilter; publicationKind: AuditPublicationKindFilter; sourceQuery: string; registrationState: AuditSourceRegistrationFilter }) {
  const { requested, history, run } = report;
  const next = history.nextCursor;
  const continuation = next === null ? null : auditBrowseHref({ ...requested, cursor: next }, runReturn, outcome, publicationKind, sourceQuery, registrationState);
  const sources = matchingAuditSourceRows(report.sources, sourceQuery).filter(source => (!outcome || source.outcome === outcome) && (!registrationState || source.registrationState === registrationState));
  const publications = history.publications.filter(row => !publicationKind || row.publicationKind === publicationKind);
  const visibleIds = new Set(publications.map(row => row.publicationId));
  const publicationAnchor = (id: string) => `recorded-publication-${id}`;
  const pageHref = auditBrowseHref(requested, runReturn, outcome, publicationKind, sourceQuery, registrationState);
  const headFilteredOut = history.publications.some(row => row.isHead) && !publications.some(row => row.isHead);
  const headOutsidePage = history.headPublicationId !== null && !history.publications.some(row => row.isHead);
  return <>
    <section className="info-band" aria-labelledby="audit-observation-heading">
      <h2 id="audit-observation-heading">Recorded audit snapshot</h2>
      <p>Query observed at (UTC): {stamp(report.observedAt)}. This is the inspection time, not a source review or source check time.</p>
      <dl>
        <div><dt>Run reference</dt><dd><code>{run.runId}</code></dd></div>
        <div><dt>Issue reference</dt><dd><code>{history.issueId}</code></dd></div>
        <div><dt>Jurisdiction reference</dt><dd>{run.jurisdictionId}</dd></div>
        <div><dt>Recorded run mode</dt><dd>{run.mode === "shadow" ? "Shadow" : "Publication-eligible mode"}</dd></div>
        <div><dt>Recorded run state</dt><dd>{runLabels[run.runState]}</dd></div>
        <div><dt>Stored commit receipt</dt><dd>{commitLabels[run.commitState]}</dd></div>
        <div><dt>Stored visibility receipt</dt><dd>{visibilityLabels[run.visibilityState]}</dd></div>
        <div><dt>Run created (UTC)</dt><dd>{stamp(run.createdAt)}</dd></div>
        <div><dt>Run finished (UTC)</dt><dd>{stamp(run.finishedAt)}</dd></div>
      </dl>
      <p>These stored run states do not establish current source health, current rights or what a visitor can see now.</p>
    </section>
    {outcome && publicationKind && <aside className="reader-recovery" aria-label="Active audit filters">
      <p>Historical check outcome: {outcomeLabels[outcome]} · Stored publication kind: {publicationLabels[publicationKind]}</p>
      <a href={auditBrowseHref(requested, runReturn, "", "", sourceQuery, registrationState)}>Clear both audit filters</a>
      <p>This retains the checked history page and selected recorded-run return. Registration state and source search are kept. Following the link makes a new audit read. Clearing filters does not establish complete history, current source health or public eligibility.</p>
    </aside>}
    <section aria-labelledby="audit-sources-heading">
      <div className="section-heading"><h2 id="audit-sources-heading">Source registrations and recorded checks</h2></div>
      <p>Registration state, permission flags and review time are query-observed values. The check outcome and its time belong to the selected historical run. Neither is a current source health assessment.</p>
      <p role="note">{report.expectedSourcesKnown ? "The expected source set is known from this run's stored manifest. Missing checks remain explicitly unrecorded." : "The expected source set is unknown. Only stored checks are shown; complete coverage cannot be inferred."}</p>
      <p>Counts describe only source rows returned for this audit, before the outcome filter. These counts remain before all three source filters. They do not establish overall source coverage or current source health.</p>
      <RecordedCountLinks label="Recorded source outcome totals" entries={auditSourceOutcomes.map(value => ({
        label: outcomeLabels[value], count: report.sources.filter(source => source.outcome === value).length,
        href: `${auditBrowseHref(requested, runReturn, value, publicationKind, sourceQuery, registrationState)}#audit-sources-heading`, selected: outcome === value,
      }))} />
      <RecordedCountLinks label="Query-observed source registration totals" entries={auditSourceRegistrationStates.map(value => ({
        label: registrationLabels[value], count: report.sources.filter(source => source.registrationState === value).length,
        href: `${auditBrowseHref(requested, runReturn, outcome, publicationKind, sourceQuery, value)}#audit-sources-heading`, selected: registrationState === value,
      }))} />
      <form method="get" action={auditPath} className="current-source-filters" aria-label="Filter query-observed registration states">
        <input type="hidden" name="runId" value={requested.runId} /><input type="hidden" name="issueId" value={requested.issueId} />
        {requested.cursor && <><input type="hidden" name="latestRevision" value={requested.cursor.latestRevision} /><input type="hidden" name="headPublicationId" value={requested.cursor.headPublicationId ?? ""} /><input type="hidden" name="beforeRevision" value={requested.cursor.beforeRevision} /></>}
        {Object.entries(auditRunReturnParams(runReturn)).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        {outcome && <input type="hidden" name="outcome" value={outcome} />}
        {publicationKind && <input type="hidden" name="publicationKind" value={publicationKind} />}
        {sourceQuery && <input type="hidden" name="sourceQ" value={sourceQuery} />}
        <div><label htmlFor="audit-registration-state">Query-observed registration state</label><select id="audit-registration-state" name="registration" defaultValue={registrationState} aria-describedby="audit-registration-help"><option value="">All registration states</option>{auditSourceRegistrationStates.map(value => <option key={value} value={value}>{registrationLabels[value]}</option>)}</select></div>
        <button type="submit">Apply registration state filter</button><a href={auditBrowseHref(requested, runReturn, outcome, publicationKind, sourceQuery)}>Clear registration state filter</a>
        <p id="audit-registration-help">This filters the registrations returned for this query, independently of historical check outcomes. Applying it makes a new audit read. An approved registration or a captured past check does not establish current rights, source health or publication eligibility.</p>
      </form>
      <form method="get" action={auditPath} className="current-source-filters" aria-label="Find a checked source registration">
        <input type="hidden" name="runId" value={requested.runId} /><input type="hidden" name="issueId" value={requested.issueId} />
        {requested.cursor && <><input type="hidden" name="latestRevision" value={requested.cursor.latestRevision} /><input type="hidden" name="headPublicationId" value={requested.cursor.headPublicationId ?? ""} /><input type="hidden" name="beforeRevision" value={requested.cursor.beforeRevision} /></>}
        {Object.entries(auditRunReturnParams(runReturn)).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        {outcome && <input type="hidden" name="outcome" value={outcome} />}
        {publicationKind && <input type="hidden" name="publicationKind" value={publicationKind} />}
        {registrationState && <input type="hidden" name="registration" value={registrationState} />}
        <div><label htmlFor="audit-source-search">Source key or exact reference in these rows</label><input id="audit-source-search" name="sourceQ" type="search" maxLength={80} defaultValue={sourceQuery} aria-describedby="audit-source-search-help" /></div>
        <button type="submit">Find recorded sources</button><a href={auditBrowseHref(requested, runReturn, outcome, publicationKind, "", registrationState)}>Clear source search</a>
        <p id="audit-source-search-help">Every word must match the same returned source key or exact registration/version reference. The outcome and registration state filters also apply. This search checks the same audit again; it does not find new sources or establish current health.</p>
      </form>
      <form method="get" action={auditPath} className="current-source-filters" aria-label="Filter recorded source outcomes">
        <input type="hidden" name="runId" value={requested.runId} /><input type="hidden" name="issueId" value={requested.issueId} />
        {requested.cursor && <><input type="hidden" name="latestRevision" value={requested.cursor.latestRevision} /><input type="hidden" name="headPublicationId" value={requested.cursor.headPublicationId ?? ""} /><input type="hidden" name="beforeRevision" value={requested.cursor.beforeRevision} /></>}
        {Object.entries(auditRunReturnParams(runReturn)).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        {sourceQuery && <input type="hidden" name="sourceQ" value={sourceQuery} />}
        {publicationKind && <input type="hidden" name="publicationKind" value={publicationKind} />}
        {registrationState && <input type="hidden" name="registration" value={registrationState} />}
        <div><label htmlFor="audit-source-outcome">Historical check outcome</label><select id="audit-source-outcome" name="outcome" defaultValue={outcome} aria-describedby="audit-source-outcome-help"><option value="">All recorded outcomes</option>{auditSourceOutcomes.map(value => <option key={value} value={value}>{outcomeLabels[value]}</option>)}</select></div>
        <button type="submit">Apply outcome filter</button><a href={auditBrowseHref(requested, runReturn, "", publicationKind, sourceQuery, registrationState)}>Clear source outcome filter</a>
        <p id="audit-source-outcome-help">This filters the bounded checked audit, not current source health. Applying it makes a new audit read; it does not collect a source or clear a hold.</p>
      </form>
      <p role="status">Showing {sources.length} of {report.sources.length} source registrations on this checked audit.</p>
      {report.sources.length === 0 ? <div className="empty-state"><h3>No source checks returned</h3><p>This does not establish successful coverage or current source health.</p></div> : sources.length === 0 ? <div className="empty-state"><h3>{sourceQuery ? "No matching source registration on this checked audit" : registrationState ? "No matching recorded source filters" : "No matching historical check outcome"}</h3><p>No matching row is shown on this checked audit. This does not establish successful coverage, absence of failed checks elsewhere or current source health.</p></div> : <ul className="current-source-list" aria-label="Recorded source registrations and checks">{sources.map(source => <li key={source.registrationId}><article>
        <h3><code>{source.sourceKey}</code></h3>
        <dl>
          <div><dt>Registration reference</dt><dd><code>{source.registrationId}</code></dd></div>
          <div><dt>Query-observed registration state</dt><dd>{registrationLabels[source.registrationState]}</dd></div>
          <div><dt>Query-observed fetch permission</dt><dd>{source.allowFetch ? "Allowed" : "Not allowed"}</dd></div>
          <div><dt>Query-observed fetch setting</dt><dd>{source.fetchEnabled ? "Enabled" : "Disabled"}</dd></div>
          <div><dt>Registration reviewed (UTC)</dt><dd>{stamp(source.reviewedAt)}</dd></div>
          <div><dt>Historical run check outcome</dt><dd>{outcomeLabels[source.outcome]}</dd></div>
          <div><dt>Historical check recorded (UTC)</dt><dd>{stamp(source.checkedAt)}</dd></div>
          <div><dt>Recorded source version</dt><dd>{source.sourceVersionId === null ? "No version recorded" : <code>{source.sourceVersionId}</code>}</dd></div>
        </dl>
      </article></li>)}</ul>}
    </section>
    <section aria-labelledby="audit-history-heading">
      <div className="section-heading"><h2 id="audit-history-heading">Stored publication history</h2></div>
      <p>Newest stored revision: {history.latestRevision}. Stored head: {history.headPublicationId === null ? "No head recorded" : <>revision {history.headRevision} · {visibleIds.has(history.headPublicationId) ? <a href={`#${publicationAnchor(history.headPublicationId)}`} aria-label={`Go to stored head revision ${history.headRevision}`}><code>{history.headPublicationId}</code></a> : <code>{history.headPublicationId}</code>}</>}.</p>
      <p>Revision numbers may have gaps. This is stored revision metadata; an accepted record or stored head does not establish current public eligibility or visibility.</p>
      <p>These issue revisions are not attributed to the selected run.</p>
      <p>Record links follow exact stored references within the visible checked page. A parent outside this page or excluded by the filter remains a reference without a navigation target.</p>
      {headOutsidePage && <p role="note">The stored head is outside this page of revisions. Its reference remains part of this history snapshot.</p>}
      <p>Counts describe only revisions on this checked page, before the publication kind filter. Other pages may contain more records; stored kind does not establish current public eligibility, visibility or attribution to this run.</p>
      <RecordedCountLinks label="Stored publication kind totals" entries={auditPublicationKinds.map(value => ({
        label: publicationLabels[value], count: history.publications.filter(row => row.publicationKind === value).length,
        href: `${auditBrowseHref(requested, runReturn, outcome, value, sourceQuery, registrationState)}#audit-history-heading`, selected: publicationKind === value,
      }))} />
      <form method="get" action={auditPath} className="current-source-filters" aria-label="Filter stored publication kinds">
        <input type="hidden" name="runId" value={requested.runId} /><input type="hidden" name="issueId" value={requested.issueId} />
        {requested.cursor && <><input type="hidden" name="latestRevision" value={requested.cursor.latestRevision} /><input type="hidden" name="headPublicationId" value={requested.cursor.headPublicationId ?? ""} /><input type="hidden" name="beforeRevision" value={requested.cursor.beforeRevision} /></>}
        {Object.entries(auditRunReturnParams(runReturn)).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        {sourceQuery && <input type="hidden" name="sourceQ" value={sourceQuery} />}
        {outcome && <input type="hidden" name="outcome" value={outcome} />}
        {registrationState && <input type="hidden" name="registration" value={registrationState} />}
        <div><label htmlFor="audit-publication-kind">Stored publication kind</label><select id="audit-publication-kind" name="publicationKind" defaultValue={publicationKind} aria-describedby="audit-publication-kind-help"><option value="">All stored publication kinds</option>{auditPublicationKinds.map(value => <option key={value} value={value}>{publicationLabels[value]}</option>)}</select></div>
        <button type="submit">Apply publication kind filter</button><a href={auditBrowseHref(requested, runReturn, outcome, "", sourceQuery, registrationState)}>Clear publication kind filter</a>
        <p id="audit-publication-kind-help">This filters only the checked revision page. Applying it makes a new audit read. A stored kind does not establish current public visibility or attribution to this run.</p>
      </form>
      <p role="status">Showing {publications.length} of {history.publications.length} stored revisions on this checked page.</p>
      {headFilteredOut && <p role="note">The stored head is excluded by this publication kind filter. Its reference remains part of this history snapshot.</p>}
      {history.publications.length === 0 ? <div className="empty-state"><h3>No publication records returned</h3><p>No revision details are shown for this page. No conclusion about public visibility follows.</p></div> : publications.length === 0 ? <div className="empty-state"><h3>No matching stored publication kind</h3><p>No matching revision is shown on this checked page. Older pages may contain matches; no conclusion about their absence or public visibility follows.</p></div> : <ol className="current-source-list" aria-label="Stored publication revisions, newest first">{publications.map(publication => <li key={publication.publicationId}><article id={publicationAnchor(publication.publicationId)}>
        <h3>Revision {publication.revision} · {publicationLabels[publication.publicationKind]}</h3>
        <dl>
          <div><dt>Publication reference</dt><dd><code>{publication.publicationId}</code> · <a href={`${pageHref}#${publicationAnchor(publication.publicationId)}`} aria-label={`Open the checked selection at revision ${publication.revision}`}>Link to this recorded revision</a></dd></div>
          <div><dt>Record created (UTC)</dt><dd>{stamp(publication.createdAt)}</dd></div>
          <div><dt>Stored head marker</dt><dd>{publication.isHead ? "Stored head for this snapshot" : "Not the stored head"}</dd></div>
          <div><dt>Supersedes record</dt><dd>{publication.supersedesPublicationId === null ? "No parent recorded" : visibleIds.has(publication.supersedesPublicationId) ? <a href={`#${publicationAnchor(publication.supersedesPublicationId)}`} aria-label={`Go to the recorded parent of revision ${publication.revision}`}><code>{publication.supersedesPublicationId}</code></a> : <code>{publication.supersedesPublicationId}</code>}</dd></div>
        </dl>
      </article></li>)}</ol>}
      <nav className="current-issue-nav" aria-label="Stored publication history pages">
        {continuation !== null && <a href={continuation}>Older stored revisions</a>}
        <a href={auditBrowseHref({ ...requested, cursor: null }, runReturn, outcome, publicationKind, sourceQuery, registrationState)}>Start a fresh audit</a>
      </nav>
      {continuation === null && <p>No older continuation is supplied for this checked page.</p>}
    </section>
  </>;
}

// Server-rendered curated fields only. Strict report parsing also protects the
// direct presentation seam; malformed or extended reports stay detail-free.
export function OperatorAuditView({ decision, selection, runReturn, outcome, publicationKind, sourceQuery, registrationState }: { decision: OperatorAuditReadDecision; selection?: OperatorAuditScope; runReturn?: OperatorAuditRunReturn | null; outcome?: unknown; publicationKind?: unknown; sourceQuery?: unknown; registrationState?: unknown }) {
  let report: OperatorAuditReport | null = null;
  let held: keyof typeof heldLabels = "unavailable";
  let selected: OperatorAuditScope | null = null;
  let expected: OperatorAuditScope | null = null;
  let returnSelection: Readonly<OperatorAuditRunReturn> | null = null;
  const filter = auditSourceOutcomeFilter(outcome);
  const kindFilter = auditPublicationKindFilter(publicationKind);
  const sourceSearch = auditSourceQuery(sourceQuery);
  const registrationFilter = auditSourceRegistrationFilter(registrationState);
  try {
    if (filter === null || kindFilter === null || sourceSearch === null || registrationFilter === null) held = "invalid_scope";
    else {
    if (decision.kind !== "invalid_scope" && selection !== undefined) {
      const checked = operatorAuditScopeSchema.safeParse(selection);
      if (checked.success) expected = checked.data;
    }
    if (decision.kind !== "invalid_scope") returnSelection = canonicalAuditRunReturn(runReturn);
    if (decision.kind === "ok") {
      const checked = operatorAuditReportSchema.safeParse(decision.report);
      if (checked.success && (selection === undefined || expected !== null &&
        JSON.stringify(expected) === JSON.stringify(checked.data.requested))) report = checked.data;
    } else if (Object.hasOwn(heldLabels, decision.kind)) held = decision.kind;
    }
  } catch { /* No input or exception details enter the held display. */ }
  if (report !== null) selected = report.requested;
  else if (held !== "invalid_scope") selected = expected;
  const [title, explanation] = heldLabels[held];
  const checkedReturn = selected !== null && returnSelection?.runId === selected.runId ? returnSelection : null;
  const fresh = selected === null ? auditPath : auditBrowseHref({ ...selected, cursor: null }, checkedReturn, filter ?? "", kindFilter ?? "", sourceSearch ?? "", registrationFilter ?? "");
  return <div className="content-page">
    <PageIntro eyebrow="Development only / Recorded operator audit" title="Recorded source and publication audit">
      <p>Inspect bounded stored run, source-check and revision metadata. This view has no source collection, approval, publication or editing control.</p>
    </PageIntro>
    <OperatorWorkspaceNavigation active="audit" context={selected ? { runId: selected.runId, issueId: selected.issueId } : {}} />
    <p><a className="arrow-link" href="/editorial-preview/audit/select">Choose from recorded runs and issues</a></p>
    {checkedReturn && <p><a href={auditRunReturnHref(checkedReturn)}>Back to selected recorded-run page</a>. Returning makes a new read; the old page is not a saved snapshot.</p>}
    <form method="get" action={auditPath} className="current-source-filters" aria-label="Choose a recorded audit">
      {Object.entries(auditRunReturnParams(checkedReturn)).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      {filter && <input type="hidden" name="outcome" value={filter} />}
      {kindFilter && <input type="hidden" name="publicationKind" value={kindFilter} />}
      {sourceSearch && <input type="hidden" name="sourceQ" value={sourceSearch} />}
      {registrationFilter && <input type="hidden" name="registration" value={registrationFilter} />}
      <div><label htmlFor="audit-run-id">Run UUID</label><input id="audit-run-id" name="runId" required maxLength={36} autoComplete="off" defaultValue={selected?.runId ?? ""} aria-describedby="audit-scope-hint" /></div>
      <div><label htmlFor="audit-issue-id">Issue UUID</label><input id="audit-issue-id" name="issueId" required maxLength={36} autoComplete="off" defaultValue={selected?.issueId ?? ""} aria-describedby="audit-scope-hint" /></div>
      <button type="submit">Inspect recorded audit</button>
      <p id="audit-scope-hint">Use exact lowercase UUIDs for one run and issue. A new inspection starts from the newest stored revision. Operational record access is not configured by this form.</p>
    </form>
    {report === null ? <section className="info-band" role="status"><h2>{title}</h2><p>{explanation}</p><a href={fresh}>{selected === null ? "Start a new selection" : "Start a fresh audit"}</a></section> : <RecordedAudit report={report} runReturn={checkedReturn} outcome={filter ?? ""} publicationKind={kindFilter ?? ""} sourceQuery={sourceSearch ?? ""} registrationState={registrationFilter ?? ""} />}
    <nav className="current-issue-nav" aria-label="Editorial workspace"><a href="/editorial-preview">Back to the review desk</a></nav>
  </div>;
}
