import { notFound } from "next/navigation";
import fixture from "../../../fixtures/fictional-pdf-appended-issue-review.json";
import { PdfAppendedIssueReviewView } from "../../../src/pdf-appended-issue-review-view.tsx";
export const dynamic="force-dynamic";
export const metadata={title:"Invented PDF whole-issue review",robots:{index:false,follow:false}};
export default function PdfAppendReviewPage(){
  if(process.env.NODE_ENV!=="development")notFound();
  return <div className="content-page"><h1>Invented PDF whole-issue review</h1><p>This fixed invented example preserves a separately supplied historical issue and appends one unverified PDF-derived statement. It accepts no input and performs no PDF inspection, database read, capture or publication. The development gate is not authentication.</p>
    <PdfAppendedIssueReviewView bundle={fixture.bundle} expected={fixture.expected}/>
    <nav aria-label="PDF review chain"><a href="/editorial-preview/pdf-preparation-history">Inspect a separate saved PDF preparation example</a>{" · "}<a href="/editorial-preview/pdf-initial-capture">Inspect a separate captured first-candidate example</a>{" · "}<a href="/editorial-preview/pdf-capture-history">Captured PDF whole-issue example</a>{" · "}<a href="/editorial-preview">Back to the review desk</a></nav>
  </div>;
}
