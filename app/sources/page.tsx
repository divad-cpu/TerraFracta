import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { ArrowLink, PageIntro, Tag } from "../components";

import { readingGuideSelectors, readingExplanationReturn, readingGuideHref } from "../../src/current-reading-guide.ts";

export const metadata: Metadata = {
  title: "Source standards",
  description: "The provenance and attribution details required for a real TerraFracta claim.",
};

export default async function Sources({ searchParams }: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const returnTo = readingExplanationReturn((await readingGuideSelectors(searchParams, unstable_rethrow)).value, unstable_rethrow);

  return <div className="content-page narrow-page"><PageIntro eyebrow="Provenance and attribution" title="What a source should tell you"><p>A published source panel should let readers understand what supports a claim, when the evidence was produced, and how it was used.</p></PageIntro>{returnTo && <div className="reader-recovery"><a href={returnTo}>Back to the selected dossier</a><p>Returning checks the current publication again. A changed or withheld edition supplies no earlier statements or references.</p></div>}<section className="source-example"><div><p className="eyebrow">Example source record</p><h2>Demonstration only</h2><Tag tone="caution">No source connected</Tag></div><dl><div><dt>Title and publisher</dt><dd>Required for a real claim</dd></div><div><dt>Original language</dt><dd>Required when applicable</dd></div><div><dt>Publication and data dates</dt><dd>Shown separately</dd></div><div><dt>Relevant location</dt><dd>Page, table, section or permissible extract</dd></div><div><dt>Relation to claim</dt><dd>What the source actually establishes</dd></div><div><dt>Decision and check</dt><dd>When the fact passed its qualified checks, or when an exception was reviewed</dd></div></dl></section>
    <section className="source-reading-guide" aria-labelledby="source-relations-heading"><h2 id="source-relations-heading">Read the relationship, not just the link</h2><dl><div><dt>Supports this wording</dt><dd>The cited location provides evidence for the specific statement. It does not automatically support a wider conclusion.</dd></div><div><dt>Points to a conflict</dt><dd>The source challenges the statement or exposes a material difference in definitions, periods or interpretation.</dd></div><div><dt>Adds context</dt><dd>The source helps explain the situation without establishing the statement itself.</dd></div></dl><ArrowLink href={returnTo ? `${readingGuideHref(returnTo)}&category=evidence` : "/methodology/glossary?category=evidence"}>Look up source and evidence terms</ArrowLink></section>
    <section className="source-reading-guide"><h2>Keep three dates separate</h2><dl><div><dt>Data period</dt><dd>When the observation applies. A recent publication may describe an older period.</dd></div><div><dt>Source publication date</dt><dd>When the publisher released the material; missing dates should be labelled as missing.</dd></div><div><dt>Evidence checked</dt><dd>When eligibility was checked. Loading this page is not a new evidence review.</dd></div></dl></section>
    <div className="info-band"><h2>No real-source dossier is published here yet</h2><p>The current interface uses invented display material. No retrieved source content or qualified real-world conclusion is connected to its sample case.</p><ArrowLink href="/countries/norway/issues/housing-costs#sources">Inspect the sample evidence section</ArrowLink></div></div>;
}
