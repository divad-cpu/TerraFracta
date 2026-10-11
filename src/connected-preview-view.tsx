import type { ConnectedReaderOutcome } from "./connected-fictional-reader.ts";
import { connectedSearch } from "./connected-fictional-reader.ts";
import { CorrectionDraft } from "../app/corrections/draft-form";

export const connectedViews = ["overview", "issue", "sources", "search"] as const;
export type ConnectedView = typeof connectedViews[number];
const labels = { overview: "Overview", issue: "Issue", sources: "Sources", search: "Search" };
const href = (view: ConnectedView, generation?: number) => `/connected-preview/${view}${generation === undefined ? "" : `?edition=${generation}`}`;

// Shared server-rendered presentation. Receives only the closed invented-data
// projection; it has no filesystem, database, network or update authority.
export function ConnectedPreviewView({ outcome, view, query = "" }: {
  outcome: ConnectedReaderOutcome; view: ConnectedView; query?: unknown;
}) {
  const snapshot = outcome.kind === "snapshot" ? outcome.snapshot : null;
  const generation = snapshot?.generation;
  const issue = snapshot?.state === "active" ? snapshot.issue : null;
  const titles = { overview: "Connected country overview", issue: issue?.title ?? "Connected issue", sources: "Sources for this update", search: "Search this update" };
  const search = snapshot ? connectedSearch(snapshot, query) : null;

  return <div className="content-page connected-preview" data-connected-view={view} data-connected-edition={generation}>
    <header className="page-intro">
      <p className="eyebrow">Local development / Connected update</p>
      <h1>{titles[view]}</h1>
      <p>An invented source feeds a checked update and these four views. No real country, survey or policy is described.</p>
      <div className="intro-tags"><span className="tag tag--caution">Fictional data</span><span>Local preview only</span></div>
    </header>
    <nav className="connected-preview__nav" aria-label="Connected preview views">
      {connectedViews.map((item) => <a key={item} href={href(item, generation)} aria-current={view === item ? "page" : undefined}>{labels[item]}</a>)}
    </nav>

    {outcome.kind === "empty" && <section className="info-band"><h2>No connected update yet</h2><p>Complete the local connected demonstration to populate these views. This page does not collect data.</p><a href="/update-preview">View the saved update examples</a></section>}
    {outcome.kind === "unavailable" && <section className="info-band" role="status"><h2>Update temporarily unavailable</h2><p>The saved update could not be checked. Earlier content is withheld until the local problem is resolved.</p></section>}
    {outcome.kind === "changed" && <section className="info-band" role="status"><h2>A newer update is available</h2><p>The update changed while you moved between views. Open the latest edition to keep the issue, source and search results together.</p><a href={href(view)}>Open latest edition</a></section>}

    {snapshot && <section className="connected-preview__status" aria-label="Update identity">
      <p><strong>Local edition {snapshot.generation}</strong> · Saved <time dateTime={snapshot.observedAt}>{snapshot.observedAt}</time></p>
      <p>{issue ? `Evidence reviewed ${issue.lastEvidenceReviewOn}` : "Source permission withdrawn in this fictional exercise."}</p>
      <a href={href(view)}>Refresh to latest edition</a>
    </section>}
    {snapshot?.state === "suppressed" && <section className="info-band" role="status"><h2>This update has been withdrawn</h2><p>The fictional source no longer permits this display. Its claim, overview excerpt, source panel and search result are withheld together.</p></section>}

    {issue && view === "overview" && <section className="connected-preview__card" data-publication-id={issue.publicationId}>
      <p className="eyebrow">Fictional country / One issue</p><h2>{issue.title}</h2><p>{issue.summary}</p>
      <p className="connected-preview__assertion">{issue.claims[0].assertion}</p>
      <p>{issue.claims[0].periodLabel} · One supporting source · Publication revision {issue.revision}</p>
      <a className="arrow-link" href={href("issue", generation)}>Read the issue and its evidence ↗</a>
    </section>}

    {issue && view === "issue" && <section className="connected-preview__card" data-publication-id={issue.publicationId}>
      <h2>What the source says</h2><p>{issue.summary}</p>
      {issue.claims.map((claim) => <article key={claim.id} className="connected-preview__claim">
        <p className="eyebrow">{claim.type.replaceAll("_", " ")} · {claim.periodLabel}</p><h3>{claim.assertion}</h3>
        {claim.evidence.map((source) => <div className="connected-preview__citation" key={`${source.sourceVersionId}:${source.locator}`}>
          <strong>{source.title}</strong><p>{source.publisher}</p><p>Exact location: {source.locator}</p>
          <p>Retrieved <time dateTime={source.retrievedAt}>{source.retrievedAt}</time></p>
          <p>Example source URL: <span className="connected-preview__url">{source.url}</span></p>
        </div>)}
      </article>)}
      <aside className="info-band"><h3>What this does not establish</h3><p>This invented numerical observation does not describe a real housing problem or establish any policy effect. No action, delivery or causal finding is supplied.</p></aside>
      <a href={href("sources", generation)}>See the source panel</a>
      <details className="connected-preview__correction">
        <summary>Try a correction draft for this edition</summary>
        <p>This local exercise uses invented wording. Its draft cannot be sent or saved and is removed when the edition is withheld or replaced.</p>
        <CorrectionDraft connectedSnapshot={snapshot} />
      </details>
    </section>}

    {issue && view === "sources" && <section className="connected-preview__card" data-publication-id={issue.publicationId}>
      <h2>Evidence used in this edition</h2><p>These are invented source descriptions. The example address is displayed as text.</p>
      <ul className="connected-preview__sources">{issue.claims.flatMap((claim) => claim.evidence.map((source) => <li key={`${claim.id}:${source.sourceVersionId}:${source.locator}`}>
        <h3>{source.title}</h3><dl>
          <div><dt>Publisher</dt><dd>{source.publisher}</dd></div>
          <div><dt>Supports</dt><dd>{claim.assertion}</dd></div>
          <div><dt>Exact location</dt><dd>{source.locator}</dd></div>
          <div><dt>Retrieved</dt><dd><time dateTime={source.retrievedAt}>{source.retrievedAt}</time></dd></div>
          <div><dt>Published</dt><dd>Not supplied</dd></div>
          <div><dt>Example URL</dt><dd className="connected-preview__url">{source.url}</dd></div>
        </dl>
      </li>))}</ul>
    </section>}

    {snapshot && view === "search" && <section className="connected-preview__card">
      <h2>Find a claim in this edition</h2>
      <form action={href("search")} method="get" className="connected-preview__search">
        <input type="hidden" name="edition" value={snapshot.generation} />
        <label htmlFor="connected-query">Search title, claim, period or source</label>
        <div><input id="connected-query" name="q" maxLength={80} defaultValue={search?.query ?? ""} /><button type="submit">Search</button></div>
      </form>
      {search?.kind === "invalid" ? <p role="status">Enter up to 80 characters without control characters.</p> :
        search?.matches && issue ? <article data-publication-id={issue.publicationId} className="connected-preview__search-result"><h3><a href={href("issue", generation)}>{issue.title}</a></h3><p>{issue.claims[0].assertion}</p><p>{issue.claims[0].periodLabel} · Fictional data · Local edition {generation}</p></article> : <p role="status">No matching visible claim in this edition.</p>}
    </section>}
    <p className="evidence-hint">New local demonstrations update all four views. Browser rendering and hosted propagation still require separate verification.</p>
  </div>;
}
