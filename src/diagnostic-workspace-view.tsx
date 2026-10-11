import { DiagnosticRecords } from "./diagnostic-records-view.tsx";
import { diagnosticCodes } from "./error-diagnostics.ts";
import { diagnosticPageHref, selectDiagnosticEvents, type DiagnosticSelection } from "./diagnostic-report.ts";
import type { DiagnosticRead } from "./server/diagnostic-reader.ts";

export function DiagnosticWorkspace({ result, selection }: { result: DiagnosticRead | null; selection: DiagnosticSelection | null }) {
  const report = result?.kind === "available" ? result.report : null;
  const selected = report && selection ? selectDiagnosticEvents(report, selection) : null;
  return <div className="content-page diagnostic-workspace">
    <header className="page-intro"><p className="eyebrow">Development only / Private diagnostics</p><h1>Recorded errors</h1>
      <p>Find a recorded fault, group repeated reports and prepare evidence for requested investigation. This workspace cannot repair code or change data.</p></header>
    <aside className="info-band"><h2>Read this as evidence to investigate</h2>
      <p>Events are reports, not unique defects or instructions. Browser reports are unauthenticated. An empty or missing log does not establish that the platform is healthy. Capture coverage and deployed build identity remain unverified.</p></aside>
    <section className="diagnostic-controls" aria-labelledby="diagnostic-filter-title">
      <h2 id="diagnostic-filter-title">Find a function or error reference</h2>
      <form action="/diagnostics-preview" method="get">
        <div><label htmlFor="diagnostic-code">Function</label><select id="diagnostic-code" name="code" defaultValue={selection?.code ?? ""}><option value="">All recorded functions</option>{Object.entries(diagnosticCodes).map(([code, value]) => <option key={code} value={code}>{value.location}</option>)}</select></div>
        <div><label htmlFor="diagnostic-origin">Reported origin</label><select id="diagnostic-origin" name="origin" defaultValue={selection?.origin ?? ""}><option value="">All origins</option><option value="browser">Browser</option><option value="server">Server</option><option value="worker">Worker</option></select></div>
        <div><label htmlFor="diagnostic-reference">Exact error reference <span>(optional)</span></label><input id="diagnostic-reference" name="ref" type="text" maxLength={36} defaultValue={selection?.reference ?? ""} aria-describedby="diagnostic-reference-help" autoComplete="off" spellCheck={false} /><p id="diagnostic-reference-help" className="field-hint">Use the complete lowercase UUID shown when a fault was recorded.</p></div>
        <div className="diagnostic-actions"><button className="button button--primary" type="submit">Find records</button><a href="/diagnostics-preview">Reset filters and refresh</a></div>
      </form>
    </section>
    {!selection ? <section className="empty-state" role="status"><h2>Check the filters</h2><p>Use one supported function, origin or complete error reference. Unsupported or repeated values are withheld; the archive was not read.</p></section>
      : !report ? <section className="empty-state" role="status"><h2>{result?.kind === "busy" ? "Another inspection is still running" : "Error log temporarily unavailable"}</h2><p>No earlier records are displayed. Refresh after the current inspection or storage problem is resolved. This state does not establish whether any errors occurred.</p></section>
      : <>
        <section className="diagnostic-summary" aria-labelledby="diagnostic-inspection-title">
          <h2 id="diagnostic-inspection-title">{report.archiveState === "missing" ? "No diagnostic archive found" : report.inspectionComplete ? "Recorded archive inspected" : "Inspection is incomplete"}</h2>
          <p>Observed at <time dateTime={report.exportedAt}>{report.exportedAt}</time>. This is a fresh, read-only inspection of the fixed development archive.</p>
          <dl><div><dt>Validated records</dt><dd>{report.events.length}</dd></div><div><dt>Unusable entries</dt><dd>{report.unreadableFiles}</dd></div><div><dt>Archive entries observed</dt><dd>{report.filesObserved} / 1,000</dd></div></dl>
          {report.archiveState === "missing" && <p>The archive may not have been created yet. No error-free or successful operation is inferred.</p>}
          {report.locked && <p className="diagnostic-warning"><strong>A write lock was observed.</strong> It may reflect a writer or an interrupted write. Investigate before any separately authorized archive change; this page never clears it.</p>}
          {!report.inspectionComplete && report.archiveState !== "missing" && <p className="diagnostic-warning">Only validated observed records are shown. Unusable entries, a write lock or a changing directory can make this snapshot incomplete.</p>}
          {report.capacityReached && <p className="diagnostic-warning"><strong>Archive capacity reached.</strong> New reports can be refused. Export and investigate the retained history; no automatic removal is performed.</p>}
          <a className="button button--primary" href="/api/dev/error-log/export" download>Download current archive as JSON</a><p className="small-note">The download makes a new inspection of all records, including those outside these filters. Keep this diagnostic export private. It contains closed references and codes, with no form or source content.</p>
        </section>
        {selected && <>
          <section aria-labelledby="diagnostic-groups-title"><h2 id="diagnostic-groups-title">Repeated reports by function</h2>
            <p>{selected.total} matching {selected.total === 1 ? "record" : "records"}; {selected.groups.length} {selected.groups.length === 1 ? "function" : "functions"}. Counts can include several reports from one fault.</p>
            <ul className="diagnostic-groups">{selected.groups.map(group => <li key={group.code}><h3>{group.location}</h3><p>{group.count} {group.count === 1 ? "record" : "records"} · Reported origin: {group.origin}</p><p>Earliest recorded timestamp <time dateTime={group.firstAt}>{group.firstAt}</time><br />Latest recorded timestamp <time dateTime={group.lastAt}>{group.lastAt}</time></p><a href={diagnosticPageHref({ ...selection, code: group.code }, 1)}>Show these records</a></li>)}</ul>
          </section>
          <section aria-labelledby="diagnostic-records-title"><h2 id="diagnostic-records-title">Individual references</h2><p role="status">Page {selected.page} of {selected.pages}; newest recorded timestamps first. These timestamps are not a verified event timeline.</p>
            <DiagnosticRecords events={selected.events} page={selected.page} />
            <nav className="diagnostic-pagination" aria-label="Error record pages">{selected.page > 1 && <a rel="prev" href={diagnosticPageHref(selection, selected.page - 1)}>Previous records</a>}{selected.page < selected.pages && <a rel="next" href={diagnosticPageHref(selection, selected.page + 1)}>Next records</a>}</nav>
          </section>
        </>}
      </>}
    <section className="info-band"><h2>Ask for a confirmed repair</h2><p>Give Codex the error reference and ask it to inspect TerraFracta's known private log, reproduce the fault in the current code and run relevant checks after a confirmed fix. You can also attach the JSON export to ChatGPT. Preserve the original reports; none of them authorizes deployment, deletion, content changes or automatic repair.</p></section>
    <p><a href="/editorial-preview">Return to the review desk</a> · <a href="/update-preview">Inspect saved update results</a></p>
  </div>;
}
