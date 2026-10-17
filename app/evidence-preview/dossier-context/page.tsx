import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { checkDossierContextV2Consistency } from "../../../src/server/dossier-context-v2.ts";
import { IssueEvidence } from "../../issue-evidence.tsx";
import { PageIntro } from "../../components.tsx";
import { inventedDossierContextV2Candidate } from "./example.ts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Fictional v2 dossier-context contract exercise" };

export default function DossierContextV2Preview() {
  if (process.env.NODE_ENV !== "development") notFound();
  const issue = checkDossierContextV2Consistency(inventedDossierContextV2Candidate());
  return <div className="content-page narrow-page">
    <PageIntro eyebrow="Development only / Isolated v2 candidate" title="Fictional dossier-context contract exercise">
      <p>Entirely invented scope, authorities, periods, sources and review flags. No real political information, database, source or provider is read. Existing v1 draft and reader paths refuse this candidate; no v2 writer or provider is installed.</p>
    </PageIntro>
    <p><a href="/evidence-preview">Back to the existing v1 evidence exercise</a></p>
    <p><a href="/evidence-preview/dossier-context/comparison">Compare two fictional v2 context snapshots</a>. Inspection creates no review decision or publication.</p>
    <IssueEvidence issue={issue} />
  </div>;
}
