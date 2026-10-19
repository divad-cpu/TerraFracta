import type {Metadata} from "next";
import {notFound,unstable_rethrow} from "next/navigation";
import {parsePdfWholeRecordedCaptureQuery,pdfWholeRecordedCaptureHref as href} from "../../../src/pdf-whole-recorded-capture-navigation.ts";
import {parsePdfAppendedCaptureLookup} from "../../../src/server/pdf-appended-capture-lookup.ts";
import {resolveRecordedPdfAppendedCaptureHistory} from "../../../src/server/recorded-pdf-appended-capture-history.ts";
import {RecordedPdfAppendedCaptureView} from "../../../src/recorded-pdf-appended-capture-view.tsx";
import {PdfPreparationReviewView} from "../../../src/pdf-preparation-review-view.tsx";
import history from "../../../fixtures/fictional-pdf-whole-capture-history.json";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Choose an illustrative complete PDF issue proposal",robots:{index:false,follow:false}};
export default async function PdfWholeCaptureHistory({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 if(process.env.NODE_ENV!=="development")notFound();
 let query:ReturnType<typeof parsePdfWholeRecordedCaptureQuery>;
 try{query=parsePdfWholeRecordedCaptureQuery(await searchParams,unstable_rethrow);}catch(error){unstable_rethrow(error);query={kind:"invalid"};}
 let decision:Awaited<ReturnType<typeof resolveRecordedPdfAppendedCaptureHistory>>|null=null;
 if(query.kind==="selected"&&query.preparationId===history.preparationId){try{
  const lookupRaw=Buffer.from(history.lookupJson,"utf8"),choices=parsePdfAppendedCaptureLookup(lookupRaw,history.preparationReportJson,history.preparationExpected,history.lookupObservedAt);
  let record=null;
  if(query.captureId!==null&&choices.matches.some(row=>row.captureId===query.captureId))record=(await import("../../../fixtures/fictional-pdf-appended-capture.json")).default;
  decision=await resolveRecordedPdfAppendedCaptureHistory({preparationId:query.preparationId,captureId:query.captureId,preparationReportJson:history.preparationReportJson,preparationExpected:history.preparationExpected,lookupRaw,lookupObservedAt:history.lookupObservedAt,captureObservedAt:history.captureObservedAt,record});
 }catch(error){unstable_rethrow(error);decision={kind:"unavailable"};}}
 return <div className="content-page"><header className="page-intro"><p className="eyebrow">Development only / Illustrative whole PDF continuation</p><h1>PDF preparation to saved whole-issue proposal</h1><p>Two explicit choices demonstrate a known historical publication basis. Metadata is generated for this example; the complete receipt is a separately supplied invented record. No native lookup, present-head check or source approval is performed. The development gate is not authentication.</p></header>
  {query.kind==="none"?<section><h2>Choose the PDF candidate preparation</h2><p>No first or newest record is selected automatically.</p><p><a href={href(history.preparationId)}>Inspect this preparation and its candidate choices</a></p></section>:decision===null?<section role="status"><h2>Selected whole PDF continuation unavailable</h2><p>No private preparation, source passage or candidate contents are displayed.</p></section>:<>
   {decision.kind==="choice_required"&&<details><summary>Inspect this separate unverified candidate preparation</summary><PdfPreparationReviewView reportJson={history.preparationReportJson} expected={history.preparationExpected}/></details>}<RecordedPdfAppendedCaptureView decision={decision}/>
  </>}
  <p><a href="/editorial-preview/pdf-whole-capture-history">Return to preparation selection</a></p><p><a href="/editorial-preview/pdf-capture-history">Inspect the separate fixed whole-issue PDF example</a></p><p><a href="/editorial-preview">Back to the review desk</a></p>
 </div>;
}
