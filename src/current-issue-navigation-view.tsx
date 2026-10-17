import { currentReadingGuideReturn, readingGuideHref } from "./current-reading-guide.ts";
import type { PublicReadResponseDecision } from "./public-read-response.ts";
import { currentIssueHref, currentIssueViews, currentIssueVisit, currentIssueSearchMatches, currentIssueReferenceMatches,
  currentIssueInspectionHref, currentIssueReturnHref, currentIssueSelectedHref, currentIssueDirectoryHref, currentIssueDirectoryFields,
  type CurrentIssueSelection } from "./current-issue-navigation.ts";
import { evidenceLabels, statementLabels } from "./issue-display-labels.ts";
import { IssueEvidence, DossierScopeNote } from "../app/issue-evidence.tsx";
import { CurrentIssueCorrectionDraft } from "../app/corrections/draft-form.tsx";
import { CurrentIssueEdition } from "../app/reader-preview/CurrentIssueEdition.tsx";
import { currentCatalogueHref, currentVisitorEntry } from "./current-visitor-catalog.ts";
import { currentIssueIdentity } from "./current-issue-status.ts";
import { issueSourceIndex, issueSourceGroupAnchor } from "./issue-source-index.ts";
import { SearchMatchText } from "./search-match-text.tsx";
import { currentIssueFilterActions } from "./current-issue-filter-actions.ts";

const labels = { issue: "Issue", sources: "Sources", search: "Search this issue" } as const;

// One checked current read per visit. A replaced or withheld edition contributes
// no statement, source or search result. URLs remain text in this held preview.
export function CurrentIssueNavigationView({ decision, selection, latestHref }: {
  decision: PublicReadResponseDecision; selection: CurrentIssueSelection; latestHref: string;
}) {
  const visit = currentIssueVisit(decision, selection.publicationId);
  const issue = visit.kind === "issue" ? visit.issue : null;
  const statementNumbers = new Map(issue ? issue.claims.map((claim, index) => [claim.id, index + 1]) : []);
  const inspectionHref = issue ? currentIssueInspectionHref(issue, selection) : "";
  const returnHref = issue ? currentIssueReturnHref(issue, selection) : null;
  const directoryHref = issue ? currentIssueDirectoryHref(issue, selection) : null;
  const directoryFields = issue ? currentIssueDirectoryFields(issue, selection) : [];
  const matches = issue && selection.view === "search" ? currentIssueSearchMatches(issue, selection.query, selection.statementType) : [];
  const sourceMatches = issue && selection.view === "sources" ? currentIssueReferenceMatches(issue, selection) : null;
  const filterActions = issue ? currentIssueFilterActions(issue, selection) : [];
  const sourceGroups = new Map(issue && selection.view === "sources" ? issueSourceIndex(issue).groups.map((group, index) =>
    [group.sourceVersionId.toLowerCase(), { ...group, anchor: issueSourceGroupAnchor(index) }] as const) : []);

  const content = <div className="content-page current-issue-visit">
    <header className="page-intro"><p className="eyebrow">Local reader preview / {labels[selection.view]}</p>
      <h1>{issue ? <SearchMatchText text={issue.title} query={selection.query} /> : "Current issue"}</h1>
      <p>This development view uses the current-candidate reader. No live source or operational provider is configured.</p>
    </header>
    {issue ? <>
      {returnHref && <div className="reader-recovery"><a href={returnHref}>Back to selected results</a><p>This return checks the current publication again. Its statements or eligible references may have changed.</p></div>}
      {directoryHref ? <div className="reader-recovery"><a href={directoryHref}>Back to selected directory results</a><p>This return checks the current directory again. Its eligible dossier or matching results may have changed.</p></div> : issue.jurisdictionSlug === currentVisitorEntry.jurisdictionSlug && issue.issueSlug === currentVisitorEntry.issueSlug && <p className="reader-recovery"><a href={currentCatalogueHref("issues", issue.publicationId, issue.jurisdictionSlug)}>Back to the current directory</a></p>}
      <nav className="current-issue-nav" aria-label="Current dossier views">
        {currentIssueViews.map(view => <a key={view} href={currentIssueSelectedHref(issue, view, selection)} aria-current={view === selection.view ? "page" : undefined}>{labels[view]}</a>)}
      </nav>
      <p className="current-issue-identity">Publication revision {issue.revision} · Last evidence review <time dateTime={issue.lastEvidenceReviewOn}>{issue.lastEvidenceReviewOn}</time></p>
      {selection.view !== "issue" && <DossierScopeNote readingGuideReturn={currentReadingGuideReturn(issue, selection)} />}
      {selection.view !== "issue" && <p className="reader-recovery"><a href={readingGuideHref(currentReadingGuideReturn(issue, selection))}>Read definitions for statement types, reference roles and dates</a>. The guide keeps this selected edition and its filters; returning reads the current publication again.</p>}
      {filterActions.length > 0 && <aside className="reader-recovery" aria-label="Active dossier filters">
        <p><strong>Active filters</strong> — remove one while keeping the other selections.</p>
        <ul>{filterActions.map(action => <li key={action.field}>{action.label}: {action.value} · <a href={action.href}>Remove {action.label.toLowerCase()}</a></li>)}</ul>
        <p>Removing a filter checks the current publication again. A wider result does not establish additional support or independent confirmation.</p>
      </aside>}
      {selection.view === "issue" && <><IssueEvidence issue={issue} readingGuideReturn={currentReadingGuideReturn(issue, selection)} />
        <details className="current-issue-correction"><summary>Try a correction draft for this publication</summary>
          <p>This local exercise uses the exact visible page or statement. Nothing is sent or saved. A changed or withheld publication removes the editor.</p>
          <CurrentIssueCorrectionDraft issue={issue} />
        </details></>}
      {selection.view === "sources" && sourceMatches && <section aria-labelledby="current-sources-title">
        <h2 id="current-sources-title">References in this dossier</h2>
        <p>{sourceMatches.total} exact {sourceMatches.total === 1 ? "reference" : "references"} in the complete dossier. A source may support several statements or be cited at different locations. This is not a count of independent sources.</p>
        <p>Original language was not supplied in this publication. An English display title does not identify the source's language.</p>
        <form action={currentIssueHref(issue, "sources", false)} method="get" className="current-source-filters">
          <input type="hidden" name="edition" value={issue.publicationId} />
          {directoryFields.map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
          <div><label htmlFor="current-source-query">Search these references</label><input id="current-source-query" name="q" type="search" maxLength={80} defaultValue={selection.query} aria-describedby="current-source-help" /></div>
          <div><label htmlFor="current-source-type">Statement type</label><select id="current-source-type" name="type" defaultValue={selection.statementType}><option value="">All statement types</option>{Object.entries(statementLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          <div><label htmlFor="current-source-relation">Reference role</label><select id="current-source-relation" name="relation" defaultValue={selection.relation}><option value="">All reference roles</option>{Object.entries(evidenceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          <button type="submit">Apply filters</button><a href={currentIssueSelectedHref(issue, "sources", selection)}>Clear filters</a>
          <p id="current-source-help">Every search word must occur in the same reference or its statement. You can also search a recorded source version reference to locate its uses. Results keep their original reference numbers. Filters do not change the complete dossier. Highlighted text locates search words in displayed fields; it does not establish support or agreement.</p>
        </form>
        <p role="status">Showing {sourceMatches.references.length} of {sourceMatches.total} references across {sourceMatches.matchingStatements} {sourceMatches.matchingStatements === 1 ? "statement" : "statements"}.</p>
        {sourceMatches.dossierConflictReferences > 0 && <div className="evidence-conflict"><strong>The complete dossier includes conflicting evidence.</strong><p>{sourceMatches.dossierConflictReferences} conflicting {sourceMatches.dossierConflictReferences === 1 ? "reference is" : "references are"} present. Filters may hide them. <a href={inspectionHref}>Read the complete statements and their evidence</a> before drawing a conclusion.</p></div>}
        {sourceMatches.references.length ? <ol className="current-source-list">{sourceMatches.references.map(({ claim, source, referenceNumber, matchedFields, anchor }) => {
          const group = sourceGroups.get(source.sourceVersionId.toLowerCase())!;
          return <li className={`current-source-entry--${source.relation}`} key={`${claim.id}:${referenceNumber}`}>
          <article><p className="eyebrow">Reference {referenceNumber} · {evidenceLabels[source.relation]}</p>
            <h3><SearchMatchText text={source.title} query={selection.query} /></h3><p><SearchMatchText text={source.publisher} query={selection.query} /></p>
            <p><strong>Statement:</strong> <a href={`${inspectionHref}#claim-${claim.id}`}><SearchMatchText text={claim.assertion} query={selection.query} /></a></p>
            <p><a href={`${inspectionHref}#${anchor}`}>Read reference {referenceNumber} in the statement</a></p>
            <p className="small-note">Statement {statementNumbers.get(claim.id)} · {statementLabels[claim.type]}{matchedFields.length > 0 ? ` · Matched in: ${matchedFields.join(", ")}` : ""}</p>
            {source.relation !== "contradicts" && claim.evidence.some(item => item.relation === "contradicts") && <p className="evidence-conflict">This statement also includes conflicting evidence. <a href={`${inspectionHref}#claim-${claim.id}`}>Read all its references</a>.</p>}
            <p className="small-note">In the complete dossier: {group.references.length} exact {group.references.length === 1 ? "reference" : "references"} across {group.statementCount} {group.statementCount === 1 ? "statement" : "statements"}. Current filters may hide other uses. {group.references.length > 1 && "Repeated use does not establish independent confirmation. "}<a href={`${inspectionHref}#${group.anchor}`}>Inspect this source version in the complete dossier</a>.</p>
            <dl><div><dt>Recorded source version reference</dt><dd><code><SearchMatchText text={source.sourceVersionId} query={selection.query} /></code></dd></div>
              <div><dt>Exact location</dt><dd><SearchMatchText text={source.locator} query={selection.query} /></dd></div>
              <div><dt>Original language</dt><dd>Not supplied in this publication</dd></div>
              <div><dt>Data period</dt><dd><SearchMatchText text={claim.periodLabel} query={selection.query} /></dd></div>
              <div><dt>Source published</dt><dd>{source.sourcePublishedOn === null ? "No verified source publication date supplied" : <time dateTime={source.sourcePublishedOn}><SearchMatchText text={source.sourcePublishedOn} query={selection.query} /></time>}</dd></div>
              <div><dt>Retrieved</dt><dd><time dateTime={source.retrievedAt}><SearchMatchText text={source.retrievedAt} query={selection.query} /></time></dd></div></dl>
            <p className="citation-card__url">Source URL: <SearchMatchText text={source.url} query={selection.query} /></p>
          </article>
        </li>; })}</ol> : <div className="info-band"><h3>No reference matches these filters</h3><p>This result concerns only the selected fields in this dossier. It does not establish that evidence is absent elsewhere.</p><a href={currentIssueSelectedHref(issue, "sources", selection)}>Show all references in this publication</a></div>}
      </section>}
      {selection.view === "search" && <section aria-labelledby="current-search-title">
        <h2 id="current-search-title">Find a statement in this dossier</h2>
        <form action={currentIssueHref(issue, "search", false)} method="get" className="current-issue-search">
          <input type="hidden" name="edition" value={issue.publicationId} />
          {directoryFields.map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
          <label htmlFor="current-issue-query">Search statements, periods and source references</label>
          <div className="search-field"><input id="current-issue-query" name="q" type="search" maxLength={80} defaultValue={selection.query} aria-describedby="current-search-help" /><button type="submit">Search</button></div>
          <label htmlFor="current-search-type">Statement type</label><select id="current-search-type" name="type" defaultValue={selection.statementType}><option value="">All statement types</option>{Object.entries(statementLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          {filterActions.length > 0 && <a href={currentIssueSelectedHref(issue, "search", selection)}>Clear this search</a>}
          <p id="current-search-help">Every search word must occur in the issue title, statement, period or its source titles, publishers, exact locations or recorded source version references. Words may occur across different references. Reference links locate one or more search words; they do not establish support or agreement. Highlighted text locates search words in displayed fields; it does not establish that one reference matches every word.</p>
        </form>
        <p role="status">{matches.length} {matches.length === 1 ? "statement matches" : "statements match"}{selection.query ? ` “${selection.query}”` : " in this dossier"}.</p>
        {matches.length ? <ol className="current-search-results">{matches.map(({ claim, matchedFields, matchedReferences }) => <li key={claim.id}>
          <a href={`${inspectionHref}#claim-${claim.id}`}><SearchMatchText text={claim.assertion} query={selection.query} /></a>
          <p>Statement {statementNumbers.get(claim.id)} · {statementLabels[claim.type]} · Data period: <SearchMatchText text={claim.periodLabel} query={selection.query} /> · {claim.evidence.length} source {claim.evidence.length === 1 ? "reference" : "references"}</p>
          {matchedFields.length > 0 && <p className="small-note">Matched in: {matchedFields.join(", ")}</p>}
          {matchedReferences.length > 0 && <ul className="current-search-reference-matches" aria-label="References with matching search words">{matchedReferences.map(({ source, referenceNumber, anchor, matchedFields: fields }) => <li key={anchor}>
            <a href={`${inspectionHref}#${anchor}`}>Reference {referenceNumber}: <SearchMatchText text={source.title} query={selection.query} /></a>
            <p className="small-note">{evidenceLabels[source.relation]} · Search words in: {fields.join(", ")}</p>
            {(fields.includes("Publisher") || fields.includes("Exact location") || fields.includes("Recorded source version")) && <dl aria-label="Matching source metadata">
              {fields.includes("Publisher") && <div><dt>Publisher</dt><dd><SearchMatchText text={source.publisher} query={selection.query} /></dd></div>}
              {fields.includes("Exact location") && <div><dt>Exact location</dt><dd><SearchMatchText text={source.locator} query={selection.query} /></dd></div>}
              {fields.includes("Recorded source version") && <div><dt>Recorded source version reference</dt><dd><code><SearchMatchText text={source.sourceVersionId} query={selection.query} /></code></dd></div>}
            </dl>}
          </li>)}</ul>}
          {claim.evidence.some(source => source.relation === "contradicts") && <p className="evidence-conflict">This statement includes conflicting evidence. Read its complete references before drawing a conclusion.</p>}
        </li>)}</ol> : <div className="info-band"><h3>No matching statement in this dossier</h3><p>This search covers only this current issue. It does not establish that an action or evidence is absent elsewhere.</p><a href={currentIssueSelectedHref(issue, "search", selection)}>Clear this search</a></div>}
      </section>}
    </> : <section className="info-band" role="status">
      <h2>{visit.kind === "changed" ? "A newer publication is available" : visit.kind === "absent" ? "No eligible issue found" : "Issue temporarily unavailable"}</h2>
      <p>{visit.kind === "changed" ? "The publication changed while you moved between views. Open the latest issue to keep its statements and references together." : visit.kind === "absent" ? "No eligible current issue is available for this route." : "The current read could not supply an eligible issue. Earlier statements and references are withheld."}</p>
      <a href={latestHref}>{visit.kind === "changed" ? "Open the latest publication" : "Check the current issue again"}</a>
    </section>}
    <p className="reader-recovery"><a href="/issues">Browse the illustrative cases</a> · <a href="/methodology">Read the evidence method</a></p>
  </div>;
  return issue ? <CurrentIssueEdition key={`${issue.publicationId}:${issue.revision}`} expected={currentIssueIdentity(issue)} latestHref={latestHref}>{content}</CurrentIssueEdition> : content;
}
