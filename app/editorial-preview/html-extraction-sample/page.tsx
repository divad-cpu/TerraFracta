import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HtmlExtractionReviewView } from "../../../src/html-extraction-review-view.tsx";
import illustrativeReport from "../../../fixtures/fictional-html-extraction-review.json";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Illustrative stored HTML extraction review", robots: { index: false, follow: false } };

export default function HtmlExtractionExample() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <div className="content-page"><header className="page-intro"><p className="eyebrow">Development only / Illustrative HTML extraction</p>
    <h1>HTML extraction review example</h1><p>Synthetic receipts demonstrate the private review flow. The development gate is not authentication.</p></header>
    <HtmlExtractionReviewView input={illustrativeReport} />
    <p><a href="/editorial-preview">Back to the review desk</a></p>
    <p><a href="/editorial-preview/html-sample">Inspect the separate supplied HTML comparison</a></p>
    <p><a href="/editorial-preview/extraction-sample">Inspect the separate plain-text extraction example</a></p>
  </div>;
}
