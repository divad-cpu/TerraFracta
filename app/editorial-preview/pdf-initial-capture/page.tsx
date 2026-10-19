import { Buffer } from "node:buffer";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PdfInitialCandidateReviewView } from "../../../src/pdf-initial-candidate-review-view.tsx";
import fixture from "../../../fixtures/fictional-pdf-initial-candidate-capture.json";

export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Invented captured PDF candidate",robots:{index:false,follow:false}};
export default function CapturedPdfCandidateExample(){
  if(process.env.NODE_ENV!=="development")notFound();
  return <div className="content-page"><header className="page-intro"><p className="eyebrow">Development only / Entirely invented</p>
    <h1>Captured PDF candidate example</h1><p>Inspect one complete supplied historical receipt from an invented isolated laboratory. This fixed example accepts no input, opens no PDF and connects to no database. Its development gate is not authentication or a current-work check.</p></header>
    <PdfInitialCandidateReviewView receipt={Buffer.from(fixture.receiptBase64,"base64")} intentJson={fixture.intentJson} expected={fixture.expected} observedAt={fixture.observedAt}/>
    <p><a href="/editorial-preview/pdf-preparation-history">Inspect a separate saved PDF preparation example</a></p>
    <p><a href="/editorial-preview/pdf-initial-capture-history">Choose a separate saved initial PDF candidate</a></p>
    <p><a href="/editorial-preview">Back to the review desk</a></p></div>;
}
