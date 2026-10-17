import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { checkPublicReadConsistency } from "../../src/public-read-consistency";
import { PageIntro, Tag } from "../components";
import { IssueEvidence } from "../issue-evidence";
import { sixStageEvidenceRows } from "./six-stage-example.ts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Fictional evidence panel rehearsal" };

export default function EvidencePreview() {
  if (process.env.NODE_ENV !== "development") notFound();
  const issue = checkPublicReadConsistency(sixStageEvidenceRows());

  return (
    <div className="content-page narrow-page">
      <PageIntro eyebrow="Development only / Source display" title="Evidence panel rehearsal">
        <p>This is an invented issue with invented source descriptions. The approved-looking values in its test fixture are not editorial or rights decisions. No real source or database record is read.</p>
        <div className="intro-tags"><Tag tone="caution">Entirely fictional</Tag><span>Not available in production mode</span></div>
      </PageIntro>
      <div className="info-band"><strong>No public claim is made here.</strong><p>Follow six separate statement types: an observed condition, a policy or action, funding, delivery, an attributed finding and evaluation. Their example periods are separate records, not evidence of a causal sequence. Support, contradiction, context and source reuse remain visible together.</p></div>
      <p><a href="/evidence-preview/dossier-context">Inspect the separate fictional v2 scope and responsibility exercise</a>. Existing v1 draft and reader paths refuse this candidate; no v2 writer or provider is installed.</p>
      <IssueEvidence issue={issue} />
    </div>
  );
}
