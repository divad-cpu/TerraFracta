import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { materializeSourceLanguageSidecarFromRows } from "../../../src/server/source-language-sidecar.ts";
import { SourceLanguageSidecarView } from "../../../src/source-language-sidecar-view.tsx";
import { PageIntro } from "../../components.tsx";
import { IssueEvidence } from "../../issue-evidence.tsx";
import { inventedSourceLanguageCandidate } from "./example.ts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Fictional source-language contract exercise" };
export default function SourceLanguagePreview() {
  if (process.env.NODE_ENV !== "development") notFound();
  const { rows, sidecar, languageReviews, finalReview } = inventedSourceLanguageCandidate();
  const candidate = materializeSourceLanguageSidecarFromRows(rows, sidecar, languageReviews, finalReview);
  return <div className="content-page narrow-page">
    <PageIntro eyebrow="Development only / Separate source-language candidate" title="Fictional source-language contract exercise">
      <p>Entirely invented language wording, content hashes, sources and accepted-looking review rows. No actual source, database, model or provider is read, and no review decision is recorded. The existing public v1 and isolated v2 formats are unchanged.</p>
    </PageIntro>
    <p><a href="/evidence-preview">Back to the existing v1 evidence exercise</a>. The panel below is a separately qualified local candidate, not a field silently added to the publication.</p>
    <SourceLanguageSidecarView candidate={candidate} prefix="source-language-example" />
    <IssueEvidence issue={candidate.issue} />
  </div>;
}
