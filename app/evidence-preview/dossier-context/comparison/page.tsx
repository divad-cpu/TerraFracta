import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { compareDossierContextV2Candidates } from "../../../../src/server/dossier-context-comparison.ts";
import { DossierContextComparisonView } from "../../../dossier-context-comparison.tsx";
import { PageIntro } from "../../../components.tsx";
import { inventedDossierContextComparisonPair } from "./example.ts";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Fictional dossier-context comparison" };
export default function DossierContextComparisonPreview() {
  if (process.env.NODE_ENV !== "development") notFound();
  const { earlier, later } = inventedDossierContextComparisonPair(), comparison = compareDossierContextV2Candidates(earlier, later);
  return <div className="content-page">
    <PageIntro eyebrow="Development only / Invented comparison" title="Fictional dossier-context comparison">
      <p>Entirely invented snapshots, source descriptions and review flags. No real current or historical source, database, provider or publication operation is read or invoked.</p>
    </PageIntro>
    <p><a href="/evidence-preview/dossier-context">Back to the fictional v2 dossier exercise</a></p>
    <DossierContextComparisonView comparison={comparison} />
  </div>;
}
