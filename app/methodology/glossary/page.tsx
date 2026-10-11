import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { ArrowLink, PageIntro } from "../../components";
import { findGlossaryTerms, glossaryCategories, glossaryHref } from "../../../src/evidence-glossary.ts";
import { readingGuideSelectors, readingExplanationHref } from "../../../src/current-reading-guide.ts";
import { ShareChangeExample } from "../../../src/share-change-view.tsx";

export const metadata: Metadata = {
  title: "Evidence reading guide",
  description: "Plain definitions of statement types, evidence relationships, dates and numerical limits used by TerraFracta.",
};
export default async function EvidenceGlossary({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const result = findGlossaryTerms((await readingGuideSelectors(searchParams, unstable_rethrow)).value, unstable_rethrow);
  return <div className="content-page narrow-page">
    <PageIntro eyebrow="Method / Reading guide" title="Understand the terms beside a statement">
      <p>Use these definitions while reading a dossier. They explain the evidence structure; they do not establish a fact about a country or approve a source.</p>
    </PageIntro>
    {result.returnTo && <div className="reader-recovery"><a href={result.returnTo}>Back to the selected dossier</a><p>Returning checks the current publication again. A changed or withheld edition supplies no earlier statements or references.</p></div>}
    <section className="issue-search" aria-labelledby="glossary-search-heading">
      <h2 id="glossary-search-heading">Find a term or a reading question</h2>
      <form action={glossaryHref()} method="get" className="issue-search__form">
        {result.returnTo && <input type="hidden" name="returnTo" value={result.returnTo} />}
        <div><label htmlFor="glossary-query">Word or question</label><input id="glossary-query" name="q" type="search" maxLength={80} defaultValue={result.query} aria-invalid={result.kind === "invalid"} aria-describedby="glossary-search-help" /></div>
        <div><label htmlFor="glossary-category">Part of the evidence</label><select id="glossary-category" name="category" defaultValue={result.category}><option value="">All terms</option>{Object.entries(glossaryCategories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <button className="button button--primary" type="submit">Find terms</button>
      </form>
      <p id="glossary-search-help" className="field-hint">Use up to 80 characters. Every word must appear within one definition or its reading question.</p>
      <p role="status">{result.kind === "invalid" ? "Check the search values" : `${result.terms.length} ${result.terms.length === 1 ? "term matches" : "terms match"}`}</p>
    </section>
    {result.kind === "invalid" ? <section className="empty-state"><h2>Check your search</h2><p>Use one query and one available category. Unsupported or repeated selectors are not accepted.</p><ArrowLink href={result.returnTo ? `/methodology/glossary?${new URLSearchParams({ returnTo: result.returnTo })}` : glossaryHref()}>Show all definitions</ArrowLink></section>
      : result.terms.length === 0 ? <section className="empty-state"><h2>No definition matches this search</h2><p>This search covers this reading guide only. Try fewer words or show all definitions.</p><ArrowLink href={result.returnTo ? `/methodology/glossary?${new URLSearchParams({ returnTo: result.returnTo })}` : glossaryHref()}>Show all definitions</ArrowLink></section>
      : <>
        <nav className="evidence-outline" aria-label="Definitions in this reading guide"><ol>{result.terms.map(term => <li key={term.slug}><a href={`#${term.slug}`}>{term.label}</a></li>)}</ol></nav>
        {result.terms.map(term => <section key={term.slug} id={term.slug} className="info-band" aria-labelledby={`${term.slug}-heading`}>
          <p className="eyebrow">{glossaryCategories[term.category]}</p><h2 id={`${term.slug}-heading`}>{term.label}</h2><p>{term.explanation}</p>
          <p><strong>Ask while reading:</strong> {term.question}</p><a href="#glossary-search-heading">Back to term search</a>
          {term.slug === "percentage-points" && <ShareChangeExample />}
        </section>)}
      </>}
    <aside className="info-band"><h2>Read the statement and its exact references together</h2><p>A label or definition cannot replace the cited evidence, dates, methods and visible limitations. No real-source dossier is published in this prototype yet.</p><ArrowLink href={readingExplanationHref("methodology", result.returnTo)}>Read the full method</ArrowLink><ArrowLink href={readingExplanationHref("sources", result.returnTo)}>Read the source standards</ArrowLink></aside>
  </div>;
}
