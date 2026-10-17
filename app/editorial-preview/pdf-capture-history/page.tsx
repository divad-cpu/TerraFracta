import { Buffer } from "node:buffer";
import { notFound } from "next/navigation";
import fixture from "../../../fixtures/fictional-pdf-appended-capture.json";
import { PdfAppendedCaptureReviewView } from "../../../src/pdf-appended-capture-review-view.tsx";
export const dynamic="force-dynamic";
export const metadata={title:"Invented captured PDF whole-issue proposal",robots:{index:false,follow:false}};
export default function CapturedPdfWholeIssueExample(){
  if(process.env.NODE_ENV!=="development")notFound();
  return <div className="content-page"><h1>Captured PDF whole-issue example</h1><p>One fixed entirely invented historical example from an isolated local laboratory. It accepts no input and opens no PDF or database connection. This development gate is not authentication or a current-work check.</p>
    <PdfAppendedCaptureReviewView receipt={Buffer.from(fixture.receiptBase64,"base64")} intentJson={fixture.intentJson} expected={fixture.expected} observedAt={fixture.observedAt}/>
    <nav aria-label="PDF review chain"><a href="/editorial-preview/pdf-append-review">Inspect a separate uncaptured whole-issue preparation</a>{" · "}<a href="/editorial-preview/pdf-initial-capture">Inspect a separate captured first-candidate example</a>{" · "}<a href="/editorial-preview">Back to the review desk</a></nav>
  </div>;
}
