import { CurrentDirectoryEntry } from "../../current-directory-entry.tsx";
import { findIllustrativeIssues, illustrativeCountry } from "../../../src/visitor-catalog.ts";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLink, PageIntro, Tag } from "../../components";
import { demoIssue } from "../../../src/demo-content";

export const metadata: Metadata = {
  title: "Norway sample overview",
  description: "An illustrative Norway overview with no verified public dossiers.",
};

export default function Norway() {
  const sample = findIllustrativeIssues({}).issues[0];
  return <div className="content-page"><nav className="breadcrumbs" aria-label="Breadcrumb"><Link href="/countries">Countries</Link><span aria-hidden="true">/</span><span>Norway</span></nav><PageIntro eyebrow="Country profile · Sample" title={illustrativeCountry.name}><p>This page shows the intended country overview. Its issue card is a synthetic display example, not a verified account of conditions in Norway.</p></PageIntro><div className="country-summary"><div><p className="eyebrow">Coverage state</p><h2>One issue in demonstration</h2><p>Real evidence has not been qualified for display here. The sample shows the structure of a dossier and cannot support a real-world conclusion.</p></div><dl><div><dt>Last editorial review</dt><dd>Not performed for this sample</dd></div><div><dt>Public issue dossiers</dt><dd>0 verified</dd></div><div><dt>Current interface</dt><dd>Local prototype</dd></div></dl></div><section className="section compact-section"><div className="section-heading"><div><p className="eyebrow">Issue directory</p><h2>Housing</h2></div><span className="section-index">01 / 01</span></div><article className="issue-list-card"><div><Tag tone="caution">Synthetic scenario</Tag><h3>{sample.title}</h3><p>{sample.summary}</p><dl className="country-issue-brief"><div><dt>Problem</dt><dd>{demoIssue.brief.problem}</dd></div><div><dt>Response and delivery</dt><dd>{demoIssue.brief.response}</dd></div><div><dt>Outcomes and limits</dt><dd>{demoIssue.brief.outcomes}</dd></div></dl></div><ArrowLink href={sample.href}>Read the sample dossier</ArrowLink></article></section><CurrentDirectoryEntry /><aside className="info-band"><h2>How are issues selected?</h2><p>Selection will use stated criteria and reviewed sources. The first displayed item is not a ranking of Norway&apos;s most important issues.</p><ArrowLink href="/methodology">See the approach</ArrowLink></aside></div>;
}
