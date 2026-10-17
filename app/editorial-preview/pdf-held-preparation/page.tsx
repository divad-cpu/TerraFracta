import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PdfHeldReviewView } from "../../../src/pdf-held-review-view.tsx";
import fixture from "../../../fixtures/fictional-pdf-held-preparation.json";

export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Invented PDF candidate preparation",robots:{index:false,follow:false}};
export default function PdfHeldPreparationExample(){
  if(process.env.NODE_ENV!=="development")notFound();
  return <div className="content-page"><header className="page-intro"><p className="eyebrow">Development only / Entirely invented</p>
    <h1>PDF candidate preparation example</h1><p>This fixed example connects an unverified PDF proposal to separately supplied held-decision and issue context. Opening the page accepts no input, parses no PDF and performs no source request. The development gate is not authentication.</p></header>
    <PdfHeldReviewView bundle={fixture.bundle} expected={fixture.expected} extractionReviewJson={fixture.extractionReviewJson} extractionReviewSha256={fixture.extractionReviewSha256}/>
    <p><a href="/editorial-preview/pdf-extraction-review">Inspect a separate invented extraction-review example</a></p>
    <p><a href="/editorial-preview/pdf-preparation-history">Inspect a separate saved PDF preparation example</a></p>
    <p><a href="/editorial-preview">Back to the review desk</a></p></div>;
}
