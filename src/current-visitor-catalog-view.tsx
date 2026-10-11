import { currentCatalogueHref, currentCatalogueViews, currentVisitorEntry,
  type CurrentVisitorEntry, type CurrentCatalogueResult } from "./current-visitor-catalog.ts";
import { currentCatalogueIssueHref } from "./current-issue-navigation.ts";
import { currentIssueIdentity } from "./current-issue-status.ts";
import { CurrentIssueEdition } from "../app/reader-preview/CurrentIssueEdition.tsx";

const labels = { overview: "Start here", countries: "Countries", issues: "Issues" } as const;
export function CurrentVisitorCatalogueView({ result, entry = currentVisitorEntry }: {
  result: CurrentCatalogueResult; entry?: CurrentVisitorEntry;
}) {
  const issue = result.kind === "available" ? result.issue : null;
  const selection = result.kind === "invalid" ? null : result.selection;
  const view = selection?.view ?? "overview";
  const freshHref = currentCatalogueHref(view);
  const content = <div className="content-page current-catalogue">
    <header className="page-intro"><p className="eyebrow">Local development / Current dossier directory</p>
      <h1>{view === "countries" ? "Explore by place" : view === "issues" ? "Find a current dossier" : "Follow an issue and its evidence"}</h1>
      <p>This directory checks one selected reader route. It does not describe worldwide coverage. The operational provider is not configured; the illustrative case remains separate.</p>
    </header>
    <nav className="current-issue-nav" aria-label="Current directory views">{currentCatalogueViews.map(item =>
      <a key={item} href={currentCatalogueHref(item, issue?.publicationId ?? null)} aria-current={view === item ? "page" : undefined}>{labels[item]}</a>)}</nav>
    {issue && result.kind === "available" && selection ? <>
      <p className="current-issue-identity">Publication revision {issue.revision} · Last evidence review <time dateTime={issue.lastEvidenceReviewOn}>{issue.lastEvidenceReviewOn}</time>. Directory links keep this edition together.</p>
      {view !== "overview" && <form action="/reader-preview/catalogue" method="get" className="issue-search__form current-catalogue-filters">
        <input type="hidden" name="view" value={view} /><input type="hidden" name="edition" value={issue.publicationId} />
        <div><label htmlFor="catalogue-query">{view === "countries" ? "Country name" : "Place, topic or issue"}</label><input id="catalogue-query" type="search" name="q" maxLength={80} defaultValue={selection.query} aria-describedby="catalogue-search-help" /></div>
        {view === "issues" && <><div><label htmlFor="catalogue-country">Country</label><select id="catalogue-country" name="country" defaultValue={selection.country}><option value="">Selected reader scope</option><option value={entry.jurisdictionSlug}>{entry.country}</option></select></div>
          <div><label htmlFor="catalogue-topic">Topic</label><select id="catalogue-topic" name="topic" defaultValue={selection.topic}><option value="">Available topic</option><option value={entry.topic}>{entry.topicLabel}</option></select></div></>}
        <button className="button button--primary" type="submit">Find {view === "countries" ? "countries" : "issues"}</button>
        <p id="catalogue-search-help">Every search word must match this {view === "countries" ? "country name" : "dossier's place, topic, title or summary"}. A missing match does not establish that an issue or public response is absent.</p>
      </form>}
      <p role="status">{result.matches ? "1" : "0"} {view === "countries" ? "country matches" : "dossier matches"} in the selected reader scope.</p>
      {result.matches ? view === "countries" ? <article className="country-row"><div><div><h2>{entry.country}</h2><p>One current dossier in this selected scope</p></div></div><a className="button button--text" href={currentCatalogueHref("issues", issue.publicationId, entry.jurisdictionSlug)}>View its dossier</a></article> :
        <article className="visitor-issue-card"><div className="visitor-issue-card__meta"><span>{entry.country} / {entry.topicLabel}</span><span>Checked current-reader result</span></div>
          <h2><a href={currentCatalogueIssueHref(issue, "issue", selection)}>{issue.title}</a></h2><p>{issue.summary}</p>
          <dl><div><dt>Evidence review</dt><dd><time dateTime={issue.lastEvidenceReviewOn}>{issue.lastEvidenceReviewOn}</time></dd></div><div><dt>Scope</dt><dd>This publication's statements and references</dd></div></dl>
          <div className="catalogue-card-actions"><a href={currentCatalogueIssueHref(issue, "issue", selection)}>Read the dossier</a><a href={currentCatalogueIssueHref(issue, "sources", selection)}>Inspect source references</a><a href={currentCatalogueIssueHref(issue, "search", selection)}>Search this dossier</a></div>
        </article> : <section className="info-band"><h2>No match in this selected scope</h2><p>The current dossier is available, but it does not match “{selection.query}”. Coverage outside this route was not checked.</p><a href={currentCatalogueHref(view, issue.publicationId)}>Clear filters</a></section>}
      {view === "overview" && <ol className="catalogue-reading-path"><li><strong>Understand the scope</strong><p>Read the title, recorded statements and their data periods.</p></li><li><strong>Inspect the basis</strong><p>Compare supporting, conflicting and contextual references at their exact locations.</p></li><li><strong>Keep uncertainty visible</strong><p>Missing statement types do not establish inaction or a measured effect. An unsent correction exercise is available in the dossier.</p></li></ol>}
    </> : <section className="info-band" role="status"><h2>{result.kind === "invalid" ? "Check the directory link" : result.kind === "changed" ? "The directory edition changed" : result.kind === "absent" ? "No eligible dossier in the selected scope" : "Current directory unavailable"}</h2>
      <p>{result.kind === "invalid" ? "Use one supported view, bounded search and available filters. No current reader was called for this invalid link." : result.kind === "changed" ? "Open the current directory again to keep its cards, statements and references on one publication. Earlier details are withheld." : result.kind === "absent" ? "The current reader confirmed no eligible issue for this one route. This is not a conclusion about other countries or issues." : "The current reader could not provide an eligible result. No zero-coverage count, earlier dossier or illustrative fallback is shown."}</p>
      <a href={freshHref}>Open the current directory again</a></section>}
    <p className="reader-recovery"><a href="/issues">Browse the separate illustrative case</a> · <a href="/methodology">Read the evidence method</a></p>
  </div>;
  return issue ? <CurrentIssueEdition key={`${issue.publicationId}:${issue.revision}`} expected={currentIssueIdentity(issue)} latestHref={freshHref}>{content}</CurrentIssueEdition> : content;
}
