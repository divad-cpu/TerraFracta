import { sourceMonitoringSnapshot } from "./source-monitoring-snapshot.ts";
import { sourceMonitoringFilter } from "./source-monitoring-filter.ts";

export const registrationLabels = { candidate: "Candidate", approved: "Approved registration", suspended: "Suspended", retired: "Retired" };
const permissionLabels = { allowed: "Fetch allowed in this observation", denied: "Fetch denied in this observation", unresolved: "Fetch permission unresolved" };
export const dueLabels = { unknown: "Due time not recorded", not_due: "Not due at this observation", due: "Due at this observation" };
const checkLabels = {
  not_recorded: "No check recorded", failed: "Recorded check failed", coverage_unknown: "Coverage unknown",
  incomplete: "Incomplete recorded check", complete_changed: "Recorded check completed; change reported",
  complete_unchanged: "Recorded check completed; no change reported",
};
const time = (value: string) => <time dateTime={value}><bdi>{value}</bdi></time>;

// Pure private example display. A supplied observation is never an operational
// fallback, current-rights proof, factual freshness claim or collector action.
export function SourceMonitoringView({ input, filter = { check: "", permission: "" } }: { input: unknown; filter?: unknown }) {
  const report = sourceMonitoringSnapshot(input);
  if (report === null) return <section><h2>Invented source monitoring unavailable</h2><p>No partial source list or zero-failure conclusion is shown.</p></section>;
  const selected = sourceMonitoringFilter(filter);
  if (selected === null) return <section><h2>Check the display filters</h2><p>No partial source list or zero-failure conclusion is shown.</p></section>;
  const visible = report.rows.map((source, index) => ({ source, index })).filter(({ source }) =>
    (!selected.check || source.check === selected.check) && (!selected.permission || source.fetchPermission === selected.permission) &&
    (!selected.registration || source.registrationState === selected.registration) && (!selected.due || source.due === selected.due));
  return <section aria-labelledby="source-monitoring-heading">
    <h2 id="source-monitoring-heading">Supplied invented observations</h2>
    <p>Entirely invented. Registration, fetch permission and due observations dated {time(report.observedAt)}. Each recorded check has its own date below. This is not a live assessment; rendering the page does not check any source.</p>
    <p>Fetch permission covers only retrieval. It does not establish permission to retain, send to a model, quote or publicly reuse material. An approved registration does not activate collection.</p>
    {report.rows.length === 0 ? <p>No source observations supplied in this invented snapshot. This does not establish zero failures or complete source coverage.</p> : <>
      <section aria-labelledby="source-monitoring-counts"><h3 id="source-monitoring-counts">Separate observation counts</h3>
        <p>{report.rows.length} source observations. Counts on different axes overlap; they are not a total number of distinct problems or a quality score.</p>
        <ul><li>Due: {report.counts.due}; not due: {report.counts.notDue}; due time unknown: {report.counts.dueUnknown}.</li>
          <li>Suspended: {report.counts.suspended}; fetch denied: {report.counts.permissionDenied}; fetch permission unresolved: {report.counts.permissionUnresolved}.</li>
          <li>No check recorded: {report.counts.noCheck}; complete recorded checks: {report.counts.complete}; incomplete: {report.counts.incomplete}; coverage unknown: {report.counts.coverageUnknown}; failed: {report.counts.failed}.</li></ul>
      </section>
      <p role="status">Showing {visible.length} of {report.rows.length} source observations in this supplied snapshot. Totals above include filtered-out observations; a filter is not a source check.</p>
      {visible.length === 0 ? <p>No observations match these display filters. Other supplied observations and their failures have not disappeared.</p> : <>
      <nav aria-label="Invented source observation details"><ul>{visible.map(({ source, index }) => <li key={source.registrationId}>
        <a href={`#source-monitoring-detail-${index + 1}`}><bdi>{source.label}</bdi> — recorded details (expand)</a>
      </li>)}</ul></nav>
      <div className="source-monitoring-table" role="region" aria-label="Invented source observations table" tabIndex={0}>
        <table><caption>Separate registration, fetch, due and recorded check states at the supplied observation</caption>
          <thead><tr><th scope="col">Source</th><th scope="col">Registration</th><th scope="col">Fetch permission</th><th scope="col">Due observation</th><th scope="col">Recorded check</th></tr></thead>
          <tbody>{visible.map(({ source }) => <tr key={source.registrationId}>
            <th scope="row"><bdi>{source.label}</bdi><br /><code>{source.sourceKey}</code></th>
            <td>{registrationLabels[source.registrationState]}</td><td>{permissionLabels[source.fetchPermission]}</td>
            <td>{dueLabels[source.due]}{source.dueAt !== null && <p>Supplied due instant: {time(source.dueAt)}</p>}</td>
            <td>{checkLabels[source.check]}{source.lastAttempt !== null && <p>Checked: {time(source.lastAttempt.checkedAt)}</p>}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {visible.map(({ source, index }) => <details key={source.registrationId} id={`source-monitoring-detail-${index + 1}`}>
        <summary>Recorded details: <bdi>{source.label}</bdi></summary>
        <p>{checkLabels[source.check]}. This result concerns the recorded check, separately from the registration, permission and due observations.</p>
        {source.lastAttempt === null ? <p>No check time, HTTP result or coverage counts were supplied. No-change cannot be inferred.</p> : <dl>
          <dt>Recorded check time</dt><dd>{time(source.lastAttempt.checkedAt)}</dd>
          <dt>Recorded transport status</dt><dd>{source.lastAttempt.httpStatus === null ? "Not recorded" : `HTTP ${source.lastAttempt.httpStatus}`}</dd>
          <dt>Defined collection units</dt><dd>Completed: {source.lastAttempt.completedUnits}; failed: {source.lastAttempt.failedUnits}; pending: {source.lastAttempt.pendingUnits}; expected: {source.lastAttempt.expectedUnits ?? "unknown"}.
            {source.lastAttempt.expectedUnits !== null && <> Unobserved: {source.lastAttempt.expectedUnits - source.lastAttempt.completedUnits - source.lastAttempt.failedUnits - source.lastAttempt.pendingUnits}.</>}</dd>
          <dt>Reported change scope</dt><dd>{source.lastAttempt.outcome === "failed" ? "No change conclusion supplied for the failed attempt."
            : source.check === "complete_changed" || source.check === "complete_unchanged" ? "Reported result covers the explicitly defined units of this check only."
              : "Any reported change or no-change covers inspected units only; full coverage is not established."}</dd>
        </dl>}
      </details>)}
      </>}
    </>}
    <p>Collection units are a supplied request/page set, not claims or independent sources. HTTP success alone proves neither complete coverage nor current claims. Complete recorded coverage does not establish historical-revision retention, factual support, source rights or publication eligibility. An outage is not evidence of government inaction.</p>
  </section>;
}
