import Link from "next/link";
import { notFound } from "next/navigation";
import fixture from "../../../fixtures/fictional-html-appended-issue-review.json";
import { HtmlAppendedIssueReviewView } from "../../../src/html-appended-issue-review-view.tsx";
export const dynamic = "force-dynamic";
export const metadata = { title: "Invented HTML whole-issue review", robots: { index: false, follow: false } };
export default function HtmlAppendReviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <div className="content-page"><h1>Invented HTML whole-issue review</h1>
    <p>This development gate is not authentication. This fixed example preserves a separately supplied historical issue and appends one unverified HTML-derived statement. It performs no storage read, capture or publication.</p>
    <HtmlAppendedIssueReviewView bundle={fixture.bundle} expected={fixture.expected} />
    <nav aria-label="HTML review chain"><Link href="/editorial-preview/html-capture-sample">Inspect the separate invented saved-composition comparison</Link>{" · "}<Link href="/editorial-preview/html-preparation-history">Back to explicit HTML preparation history</Link>{" · "}<Link href="/editorial-preview">Back to the review desk</Link></nav>
  </div>;
}
