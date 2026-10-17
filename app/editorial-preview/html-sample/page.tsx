import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HtmlInspectionView } from "../../../src/html-inspection-view.tsx";
import inventedReport from "../../../fixtures/fictional-html-inspection.json";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Invented HTML text comparison", robots: { index: false, follow: false } };

export default function HtmlExample() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <div className="content-page"><header className="page-intro"><p className="eyebrow">Development only / Invented HTML inspection</p>
    <h1>HTML text comparison example</h1><p>A fixed report from the offline Python producer. The development gate is not authentication.</p></header>
    <HtmlInspectionView input={inventedReport} />
    <p><a href="/editorial-preview">Back to the review desk</a></p>
    <p><a href="/editorial-preview/source-discovery">Inspect the invented feed-discovery comparison</a></p>
    <p><a href="/editorial-preview/extraction-sample">Inspect the separate retained plain-text extraction example</a></p>
  </div>;
}
