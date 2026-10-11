import { CurrentDirectoryEntry } from "./current-directory-entry.tsx";
import { findIllustrativeIssues, illustrativeCountry } from "../src/visitor-catalog.ts";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLink, Tag } from "./components";

export const metadata: Metadata = {
  title: "TerraFracta — Local prototype",
};

export default function Home() {
  const sample = findIllustrativeIssues({}).issues[0];
  return (
    <>
      <section className="hero">
        <div className="hero__copy">
          <p className="eyebrow">A clearer view of public issues</p>
          <h1>Understand the issue.<br /><em>See the response.</em><br />Follow the evidence.</h1>
          <p className="hero__lead">TerraFracta is being built to bring measured problems, documented public action, and evidence of delivery into one readable place.</p>
          <div className="hero__actions">
            <Link className="button button--primary" href="/issues">Explore issues <span aria-hidden="true">↗</span></Link>
            <Link className="button button--text" href="/methodology">How this works <span aria-hidden="true">↗</span></Link>
          </div>
          <p className="hero__footnote">ONE COUNTRY · ONE ILLUSTRATIVE ISSUE · LOCAL DEVELOPMENT</p>
        </div>
        <div className="hero__visual" role="img" aria-label="Four stages: observe the problem, document the action, check delivery, assess outcomes">
          <div className="visual-orbit visual-orbit--outer" />
          <div className="visual-orbit visual-orbit--inner" />
          <div className="visual-center" aria-hidden="true"><span>TF</span><small>01 / 04</small></div>
          <div className="visual-label visual-label--one" aria-hidden="true"><b>01</b><span>Observe<br />the problem</span></div>
          <div className="visual-label visual-label--two" aria-hidden="true"><b>02</b><span>Document<br />the action</span></div>
          <div className="visual-label visual-label--three" aria-hidden="true"><b>03</b><span>Check<br />delivery</span></div>
          <div className="visual-label visual-label--four" aria-hidden="true"><b>04</b><span>Assess<br />outcomes</span></div>
        </div>
      </section>
      <section className="home-discovery" aria-labelledby="home-search-heading">
        <div><p className="eyebrow">Begin with a question</p><h2 id="home-search-heading">Find a place or an issue</h2><p>One illustrative Norway case is available. Every result shows its coverage and evidence state.</p></div>
        <form action="/issues" method="get"><label htmlFor="home-query">Search the demonstration</label><div className="search-field"><input id="home-query" name="q" type="search" maxLength={80} placeholder="Norway, housing, household budgets…" /><button type="submit">Search <span aria-hidden="true">↗</span></button></div></form>
      </section>
      <section className="section featured-section" aria-labelledby="featured-title">
        <div className="section-heading"><div><p className="eyebrow">Explore the first case</p><h2 id="featured-title">A place to start</h2></div><span className="section-index">01 / FEATURED</span></div>
        <article className="feature-card">
          <div className="feature-card__top"><span className="feature-card__country">{illustrativeCountry.monogram} <span>↗</span> {illustrativeCountry.name.toUpperCase()}</span><Tag tone="caution">Illustrative case</Tag></div>
          <div className="feature-card__body"><div><p className="eyebrow">Housing · Household budgets</p><h3>{sample.title}</h3><p>Follow a sample dossier from an indicator through policy, delivery, and what remains unknown.</p></div><div className="feature-card__number"><span>01</span><small>ISSUE IN VIEW</small></div></div>
          <ArrowLink href={sample.href}>Open the sample issue</ArrowLink>
        </article>
      </section>
      <CurrentDirectoryEntry />
      <section className="section principles" aria-labelledby="principles-title"><div className="section-heading"><div><p className="eyebrow">Our approach</p><h2 id="principles-title">Built for careful reading</h2></div><span className="section-index">02 / METHOD</span></div><div className="principle-grid"><article><span className="principle-icon">◎</span><h3>Show the basis</h3><p>Dates, definitions and source links belong beside the claims they support.</p></article><article><span className="principle-icon">≋</span><h3>Separate the stages</h3><p>A policy announcement, delivery record and observed outcome answer different questions.</p></article><article><span className="principle-icon">◌</span><h3>Keep uncertainty visible</h3><p>Missing or disputed evidence stays visible instead of becoming a score or verdict.</p></article></div><ArrowLink href="/methodology">Read the methodology</ArrowLink></section>
    </>
  );
}
