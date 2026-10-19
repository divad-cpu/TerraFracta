import type {Metadata} from "next";
import {notFound,unstable_rethrow} from "next/navigation";
import {parsePdfInitialRecordedCaptureQuery,pdfInitialRecordedCaptureHref as href} from "../../../src/pdf-initial-recorded-capture-navigation.ts";
import {parsePdfInitialCandidateCaptureLookup} from "../../../src/server/pdf-initial-candidate-capture-lookup.ts";
import {resolveRecordedPdfInitialCaptureHistory} from "../../../src/server/recorded-pdf-initial-capture-history.ts";
import {RecordedPdfInitialCaptureView} from "../../../src/recorded-pdf-initial-capture-view.tsx";
import {PdfPreparationReviewView} from "../../../src/pdf-preparation-review-view.tsx";
import history from "../../../fixtures/fictional-pdf-initial-capture-history.json";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Choose an illustrative initial PDF candidate",robots:{index:false,follow:false}};
export default async function PdfInitialCaptureHistory({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 if(process.env.NODE_ENV!=="development")notFound();
 let query:ReturnType<typeof parsePdfInitialRecordedCaptureQuery>;
 try{query=parsePdfInitialRecordedCaptureQuery(await searchParams,unstable_rethrow);}catch(error){unstable_rethrow(error);query={kind:"invalid"};}
 let decision:Awaited<ReturnType<typeof resolveRecordedPdfInitialCaptureHistory>>|null=null;
 if(query.kind==="selected"&&query.preparationId===history.preparationId){try{
  const lookupRaw=Buffer.from(history.lookupJson,"utf8"),choices=parsePdfInitialCandidateCaptureLookup(lookupRaw,history.preparationReportJson,history.preparationExpected,history.lookupObservedAt);
  let record=null;
  if(query.captureId!==null&&choices.matches.some(row=>row.captureId===query.captureId))record=(await import("../../../fixtures/fictional-pdf-initial-selection-record.json")).default;
  decision=await resolveRecordedPdfInitialCaptureHistory({preparationId:query.preparationId,captureId:query.captureId,preparationReportJson:history.preparationReportJson,preparationExpected:history.preparationExpected,lookupRaw,lookupObservedAt:history.lookupObservedAt,captureObservedAt:history.captureObservedAt,record});
 }catch(error){unstable_rethrow(error);decision={kind:"unavailable"};}}
 return <div className="content-page"><header className="page-intro"><p className="eyebrow">Development only / Illustrative initial PDF continuation</p><h1>PDF preparation to first saved candidate</h1><p>Two explicit choices demonstrate the empty-head branch. All records are illustrative and invented. The development gate is not authentication.</p></header>
  {query.kind==="none"?<section><h2>Choose the initial PDF preparation</h2><p>No first or newest record is selected automatically.</p><p><a href={href(history.preparationId)}>Inspect this preparation and its candidate choices</a></p></section>:decision===null?<section role="status"><h2>Selected initial PDF continuation unavailable</h2><p>No private preparation, source passage or candidate contents are displayed.</p></section>:<>
   {decision.kind==="choice_required"&&<details><summary>Inspect this separate unverified preparation</summary><PdfPreparationReviewView reportJson={history.preparationReportJson} expected={history.preparationExpected}/></details>}<RecordedPdfInitialCaptureView decision={decision}/>
  </>}
  <p><a href="/editorial-preview/pdf-initial-capture-history">Return to preparation selection</a></p><p><a href="/editorial-preview/pdf-capture-history">Inspect the separate known-base PDF example</a></p><p><a href="/editorial-preview/pdf-whole-capture-history">Choose a separate saved complete PDF issue proposal</a></p><p><a href="/editorial-preview">Back to the review desk</a></p>
 </div>;
}
