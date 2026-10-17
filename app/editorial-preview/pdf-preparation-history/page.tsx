import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PdfPreparationReviewView } from "../../../src/pdf-preparation-review-view.tsx";
import fixture from "../../../fixtures/fictional-stored-pdf-preparation-review.json";

export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Invented saved PDF preparation",robots:{index:false,follow:false}};
export default function SavedPdfPreparationExample(){
  if(process.env.NODE_ENV!=="development")notFound();
  return <div className="content-page"><header className="page-intro"><p className="eyebrow">Development only / Entirely invented</p>
    <h1>Saved PDF preparation example</h1><p>Inspect one supplied historical preparation with separate candidate, storage and reopening times. This fixed example accepts no input, opens no PDF and connects to no database. The development gate is not authentication.</p></header>
    <PdfPreparationReviewView reportJson={fixture.reportJson} expected={fixture.expected}/>
    <p><a href="/editorial-preview/pdf-held-preparation">Inspect a separate detached PDF candidate example</a></p>
    <p><a href="/editorial-preview/pdf-append-review">Inspect a separate PDF whole-issue preparation example</a></p>
    <p><a href="/editorial-preview/pdf-initial-capture">Inspect a separate captured PDF candidate example</a></p>
    <p><a href="/editorial-preview">Back to the review desk</a></p></div>;
}
