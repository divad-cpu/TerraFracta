import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { ArrowLink, PageIntro, Tag } from "../components";
import { findIllustrativeCountries } from "../../src/visitor-catalog.ts";
import { awaitRouteSelectors } from "../../src/await-route-selectors.ts";
import { CurrentDirectoryEntry } from "../current-directory-entry.tsx";

export const metadata: Metadata = {
  title: "Sample country directory",
  description: "Explore the one illustrative country in the local TerraFracta prototype.",
};

export default async function Countries({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const search = findIllustrativeCountries((await awaitRouteSelectors(searchParams, unstable_rethrow)).value, unstable_rethrow);
  const query = search.query;
  return (
    <div className="content-page">
      <PageIntro eyebrow="01 / Country directory" title="Explore by place"><p>Coverage is limited to one illustrative Norway case while the research and publication workflow is built.</p></PageIntro>
      <section className="directory-controls" aria-label="Find a country"><form action="/countries" method="get"><label htmlFor="country-search">Find a country</label><div className="search-field"><input id="country-search" name="q" type="search" maxLength={80} placeholder="Search country name" defaultValue={query} aria-invalid={search.kind === "invalid"} aria-describedby="country-search-guidance" /><button type="submit">Search <span aria-hidden="true">↗</span></button></div><p id="country-search-guidance" className="field-hint">Enter one country name, up to 80 characters.</p></form><p>1 sample country · no verified public dossiers</p></section>
      <div className="list-heading"><span>COUNTRY</span><span>COVERAGE</span></div>
      {search.kind === "invalid" ? <div className="empty-state" role="status"><h2>Check your search</h2><p>Enter one search value, up to 80 characters, without control characters.</p><ArrowLink href="/countries">Clear search</ArrowLink></div> : search.countries.length > 0 ? search.countries.map(country => <article className="country-row" key={country.slug}><div><span className="country-monogram" aria-hidden="true">{country.monogram}</span><div><h2>{country.name}</h2><p>One illustrative housing issue</p></div></div><div className="country-row__end"><Tag tone="caution">{country.coverage}</Tag><ArrowLink href={country.href}>View country</ArrowLink></div></article>) : <div className="empty-state" role="status"><h2>No sample country matches “{query}”</h2><p>The prototype currently includes Norway only.</p><ArrowLink href="/countries">Clear search</ArrowLink></div>}
      <CurrentDirectoryEntry />
      <p className="small-note">A country appearing here does not imply that its issues have passed editorial review or public publication checks.</p>
    </div>
  );
}
