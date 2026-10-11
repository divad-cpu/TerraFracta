import { CurrentDirectoryEntry } from "../current-directory-entry.tsx";
import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import Link from "next/link";
import { ArrowLink, PageIntro, Tag } from "../components";
import { findIllustrativeIssues, visitorTopics } from "../../src/visitor-catalog.ts";
import { awaitRouteSelectors } from "../../src/await-route-selectors.ts";

export const metadata: Metadata = {
  title: "Explore issues — demonstration",
  description: "Find the illustrative TerraFracta case by place, topic or issue. No verified public dossiers are available yet.",
};

export default async function Issues({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const result = findIllustrativeIssues((await awaitRouteSelectors(searchParams, unstable_rethrow)).value, unstable_rethrow);
  return <div className="content-page">
    <PageIntro eyebrow="Explore / Issue directory" title="Find an issue to understand">
      <p>Start with a place, a topic or a question. The current directory contains one illustrative Norway case; it is not a ranking or verified country coverage.</p>
    </PageIntro>
    <section className="issue-search" aria-labelledby="issue-search-heading">
      <h2 id="issue-search-heading">Search the demonstration</h2>
      <form action="/issues" method="get" className="issue-search__form">
        <div><label htmlFor="issue-query">Place or issue</label><input id="issue-query" name="q" type="search" maxLength={80} defaultValue={result.query} placeholder="Try Norway, housing or household budgets" aria-invalid={result.kind === "invalid"} aria-describedby="issue-search-help" /></div>
        <div><label htmlFor="issue-topic">Topic</label><select id="issue-topic" name="topic" defaultValue={result.topic}><option value="">All available topics</option>{visitorTopics.map(topic => <option key={topic.slug} value={topic.slug}>{topic.label}</option>)}</select></div>
        <button className="button button--primary" type="submit">Find issues <span aria-hidden="true">↗</span></button>
      </form>
      <p className="field-hint" id="issue-search-help">Use up to 80 characters. Every search word must match the available case. Results show their coverage state.</p>
    </section>
    <div className="directory-summary"><p role="status">{result.kind === "invalid" ? "Search needs attention" : `${result.issues.length} illustrative ${result.issues.length === 1 ? "case" : "cases"} found`}</p><span>Verified public dossiers: 0</span></div>
    {result.kind === "invalid" ? <div className="empty-state"><h2>Check your search</h2><p>Use one search value and an available topic. Repeated values, unsupported selectors and control characters are not accepted.</p><ArrowLink href="/issues">Reset search</ArrowLink></div> : result.issues.length === 0 ? <div className="empty-state"><h2>No case matches “{result.query}”</h2><p>Coverage is still limited to the Norway housing demonstration. A missing result says nothing about whether a real issue or public response exists.</p><ArrowLink href="/issues">Show the available case</ArrowLink></div> : <div className="visitor-issue-grid">{result.issues.map(issue => <article className="visitor-issue-card" key={issue.href}>
      <div className="visitor-issue-card__meta"><span>{issue.country} / {issue.topicLabel}</span><Tag tone="caution">{issue.coverage}</Tag></div>
      <h2><Link href={issue.href}>{issue.title}</Link></h2><p>{issue.summary}</p>
      <dl><div><dt>Evidence review</dt><dd>{issue.evidenceReview}</dd></div><div><dt>Figures and events</dt><dd>Illustrative</dd></div></dl>
      <ArrowLink href={issue.href}>Read the sample dossier</ArrowLink>
    </article>)}</div>}
    <CurrentDirectoryEntry />
    <aside className="info-band"><h2>Understand the evidence before drawing a conclusion</h2><p>A future dossier will distinguish the measured problem, documented action, delivery and outcomes, with source dates and visible limitations.</p><ArrowLink href="/methodology">Read our method</ArrowLink></aside>
  </div>;
}
