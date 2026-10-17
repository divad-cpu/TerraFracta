import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DetachedPreparationView } from "../../../src/detached-preparation-view.tsx";
import inventedReport from "../../../fixtures/fictional-detached-preparation.json";
import inventedExpected from "../../../fixtures/fictional-detached-preparation-expected.json";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Invented historical preparation", robots: { index: false, follow: false } };
export default function PreparationExample() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <div className="content-page"><header className="page-intro"><p className="eyebrow">Development only / Invented preparation</p>
    <h1>Historical preparation example</h1><p>A fixed report from the offline Python producer. The development gate is not authentication.</p></header>
    <DetachedPreparationView raw={JSON.stringify(inventedReport)} expected={inventedExpected} />
    <p><a href="/editorial-preview/append-review-sample">Follow the complete invented issue preparation</a></p>
    <p><a href="/editorial-preview">Back to the review desk</a></p>
    <p><a href="/editorial-preview/preparation-history">Choose a recorded invented preparation explicitly</a></p>
    <p><a href="/editorial-preview/extraction-sample">Inspect the extraction-only example</a></p></div>;
}
