import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { ArrowLink, PageIntro } from "../components";

import { readingGuideSelectors, readingExplanationContext, readingGuideHref, readingReturnHref } from "../../src/current-reading-guide.ts";

export const metadata: Metadata = {
  title: "Methodology and limits",
  description: "How TerraFracta plans to distinguish issues, responses, outcomes and evidence gaps.",
};

export default async function Methodology({ searchParams }: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const returnContext = readingExplanationContext((await readingGuideSelectors(searchParams, unstable_rethrow)).value, unstable_rethrow);
  const returnTo = returnContext?.returnTo, returnAnchor = returnContext?.returnAnchor;

  return (
    <div className="content-page narrow-page">
      <PageIntro eyebrow="Method and limits" title="How TerraFracta reads an issue">
        <p>A draft public explanation of the evidence structure and planned update process. The actual publication process is still under development.</p>
      </PageIntro>
      {returnTo && <div className="reader-recovery"><a href={readingReturnHref(returnTo, returnAnchor)!}>Back to the selected dossier</a><p>Returning checks the current publication again. A changed or withheld edition supplies no earlier statements or references.</p></div>}
      <div className="info-band"><h2>Understand the terms beside a statement</h2><p>Look up funding, delivery, source conflicts, review dates and numerical comparisons in the reading guide.</p><ArrowLink href={readingGuideHref(returnTo, returnAnchor)}>Find a term or a reading question</ArrowLink></div>
      <div className="method-list">
        <section><span>01</span><div><h2>Choose a scoped issue</h2><p>Define the geography, affected population and measurable problem. Inclusion is based on stated criteria and evidence availability, not a claim that the issue is objectively the country&apos;s largest.</p></div></section>
        <section><span>02</span><div><h2>Trace the response</h2><p>Record dated decisions, funding, implementation and evaluation separately. Identify responsible bodies and link every material claim to its source.</p></div></section>
        <section><span>03</span><div><h2>Check what changed</h2><p>Show the data period, definitions, revisions and comparability limits. An observed change is not, on its own, proof of policy effect.</p></div></section>
        <section><span>04</span><div><h2>Show the gaps</h2><p>Uncertain, disputed or missing evidence remains visible. A failed collection run cannot become a statement that no government action exists.</p></div></section>
      </div>
      <div className="info-band">
        <h2>How updates are planned to work</h2>
        <p>Approved sources will be checked on a schedule or when the operator starts a permitted run. New facts within a tested source rule can be published automatically when their dates, meaning and exact evidence pass the checks. Unclear changes wait for review. Each published fact should show its source and when it was checked.</p>
      </div>
      <div className="info-band">
        <h2>Current prototype limit</h2>
        <p>The sample issue has no connected source, automated run or publication approval. The interface demonstrates the structure only.</p>
      </div>
    </div>
  );
}
