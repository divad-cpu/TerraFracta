import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import Link from "next/link";
import { PageIntro, Tag } from "../components";
import { CorrectionDraft } from "./draft-form";
import { sampleCorrectionSection, sampleIssuePath, sampleSections } from "../../src/visitor-catalog.ts";
import { awaitRouteSelectors } from "../../src/await-route-selectors.ts";

export const metadata: Metadata = {
  title: "Correction draft preview",
  description: "A local interface exercise. Reports cannot be sent or saved.",
};

export default async function CorrectionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const section = sampleCorrectionSection((await awaitRouteSelectors(searchParams, unstable_rethrow)).value, unstable_rethrow);
  if (section === "invalid") return <div className="content-page narrow-page"><PageIntro eyebrow="Correction draft / Link needs attention" title="Check the draft link"><p>This demonstration accepts only one of its visible sample sections. No draft has been opened, sent or saved.</p></PageIntro><Link className="arrow-link" href="/corrections">Open the whole-page draft</Link></div>;
  return (
    <div className="content-page narrow-page">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/">Home</Link><span aria-hidden="true">/</span><span>Correction draft</span>
      </nav>
      <PageIntro eyebrow="Reader participation / Local exercise" title="Preview a correction">
        <p>Test how a reader could describe an error or missing context. This page has no submission service. Your draft stays in this browser tab and disappears when you reset or reload it.</p>
        <div className="intro-tags"><Tag tone="caution">Nothing is sent or saved from this draft</Tag><span>No correction queue is connected</span></div>
      </PageIntro>
      <div className="info-band correction-warning">
        <strong>Use sample text only</strong>
        <p>Do not enter personal information, confidential material or a real report. This prototype offers no way to deliver a correction to the TerraFracta team.</p>
      </div>
      {section && <p className="sample-correction-context">Selected section: <strong>{sampleSections[section]}</strong>. <Link href={`${sampleIssuePath}#${section}`}>Return to this part of the case</Link>.</p>}
      <CorrectionDraft sampleSection={section} key={section ?? "page"} />
      <p className="small-note">The sample issue is <Link href="/countries/norway/issues/housing-costs">Norway / Housing costs</Link>. Its content and figures are fabricated for this local interface exercise.</p>
    </div>
  );
}
