import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { checkPublicReadConsistency } from "../../src/public-read-consistency";
import { PageIntro, Tag } from "../components";
import { IssueEvidence } from "../issue-evidence";
import { syntheticReadRows } from "./example";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Fictional evidence panel rehearsal" };

export default function EvidencePreview() {
  if (process.env.NODE_ENV !== "development") notFound();
  const issue = checkPublicReadConsistency(syntheticReadRows);

  return (
    <div className="content-page narrow-page">
      <PageIntro eyebrow="Development only / Source display" title="Evidence panel rehearsal">
        <p>This is an invented issue with invented source descriptions. The approved-looking values in its test fixture are not editorial or rights decisions. No real source or database record is read.</p>
        <div className="intro-tags"><Tag tone="caution">Entirely fictional</Tag><span>Not available in production mode</span></div>
      </PageIntro>
      <div className="info-band"><strong>No public claim is made here.</strong><p>This page exercises how distinct support, contradiction and context would remain visible together.</p></div>
      <IssueEvidence issue={issue} />
    </div>
  );
}
