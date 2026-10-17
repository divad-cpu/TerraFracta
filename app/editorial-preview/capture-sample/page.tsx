import type {Metadata} from "next";
import {notFound} from "next/navigation";
import {AppendedCaptureView} from "../../../src/appended-capture-view.tsx";
import invented from "../../../fixtures/fictional-appended-capture.json";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Invented saved composition comparison",robots:{index:false,follow:false}};
export default function SavedCompositionExample(){
 if(process.env.NODE_ENV!=="development")notFound();
 return <div className="content-page"><header className="page-intro"><p className="eyebrow">Development only / Invented saved comparison</p><h1>Saved whole-issue example</h1><p>Retained outputs from one isolated local rehearsal. The development gate is not authentication.</p></header>
  <AppendedCaptureView raw={Buffer.from(invented.rawReceiptJson,"utf8")} retainedIntentJson={invented.retainedIntentJson} observedAt={invented.observedAt} actualReport={invented.actualComparison}/>
  <p><a href="/editorial-preview/append-review-sample">Inspect the separate unsaved whole-issue example</a></p><p><a href="/editorial-preview/preparation-history">Return to historical preparation choices</a></p><p><a href="/editorial-preview">Back to the review desk</a></p><p><a href="/editorial-preview/capture-history">Choose the related historical preparation and saved composition</a></p></div>;
}
