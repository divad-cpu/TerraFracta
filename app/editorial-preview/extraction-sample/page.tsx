import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrivateExtractionView } from "../../../src/private-extraction-view.tsx";
import inventedReport from "../../../fixtures/fictional-private-extraction.json";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Invented extraction evidence", robots: { index: false, follow: false } };
export default function ExtractionExample() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <div className="content-page"><header className="page-intro"><p className="eyebrow">Development only / Invented extraction evidence</p>
    <h1>Extraction evidence example</h1><p>A fixed report from the offline Python producer. The development gate is not authentication.</p></header>
    <PrivateExtractionView input={inventedReport} /><p><a href="/editorial-preview">Back to the review desk</a></p>
    <p><a href="/editorial-preview/preparation-sample">Follow the invented historical preparation and source context</a></p>
    <p><a href="/editorial-preview/source-discovery">Inspect the invented feed-discovery comparison</a></p></div>;
}
