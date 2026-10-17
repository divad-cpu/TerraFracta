import type { Metadata } from "next";
import { notFound,unstable_rethrow } from "next/navigation";
import { parseHtmlRecordedCaptureQuery,htmlRecordedCaptureHref } from "../../../src/html-recorded-capture-navigation.ts";
import { parseHtmlAppendedCaptureLookup } from "../../../src/server/html-appended-capture-lookup.ts";
import { resolveRecordedHtmlAppendedCapture } from "../../../src/server/recorded-html-appended-capture.ts";
import { RecordedHtmlAppendedCaptureView } from "../../../src/recorded-html-appended-capture-view.tsx";
import { HtmlPreparationReviewView } from "../../../src/html-preparation-review-view.tsx";
import history from "../../../fixtures/fictional-html-capture-history.json";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Choose a recorded HTML composition",robots:{index:false,follow:false}};
export default async function HtmlCaptureHistory({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 if(process.env.NODE_ENV!=="development")notFound();
 let query:ReturnType<typeof parseHtmlRecordedCaptureQuery>;
 try{query=parseHtmlRecordedCaptureQuery(await searchParams,unstable_rethrow);}catch(error){unstable_rethrow(error);query={kind:"invalid"};}
 let decision:Awaited<ReturnType<typeof resolveRecordedHtmlAppendedCapture>>|null=null;
 if(query.kind==="selected"&&query.preparationId===history.preparationId){
  try{
   const lookupRaw=Buffer.from(history.lookupJson,"utf8"),choices=parseHtmlAppendedCaptureLookup(lookupRaw,history.preparationReportJson,history.preparationExpected,history.observedAt);
   // Only a checked, explicitly chosen metadata member loads the full fixture.
   let record=null;
   if(query.captureId!==null&&choices.matches.some(row=>row.captureId===query.captureId)){
    const {default:saved}=await import("../../../fixtures/fictional-html-appended-capture.json");
    record={retainedIntentJson:saved.retainedIntentJson,rawReceiptJson:Buffer.from(saved.rawBase64,"base64").toString("utf8"),actualComparisonJson:JSON.stringify(saved.actualReport)};
   }
   decision=await resolveRecordedHtmlAppendedCapture({preparationId:query.preparationId,captureId:query.captureId,
    preparationReportJson:history.preparationReportJson,preparationExpected:history.preparationExpected,lookupRaw,observedAt:history.observedAt,record});
  }catch(error){unstable_rethrow(error);decision={kind:"unavailable"};}
 }
 return <div className="content-page"><header className="page-intro"><p className="eyebrow">Development only / Explicit recorded HTML continuation</p><h1>HTML preparation to saved composition</h1>
  <p>Fixed invented records demonstrate two separate choices. The development gate is not authentication. These records remain unpublished.</p></header>
  {query.kind==="none"?<section><h2>Choose the recorded HTML preparation</h2><p>No preparation or composition is selected automatically. Opening the example does not renew its historical observations.</p>
   <p><a href={htmlRecordedCaptureHref(history.preparationId)}>Inspect this preparation and its saved composition choices</a></p></section>:decision===null?<section role="status"><h2>Selected HTML continuation unavailable</h2><p>The requested selection could not be matched. No preparation, source passage or composition contents are displayed.</p></section>:<>
    {decision.kind==="choice_required"&&<details><summary>Inspect this separately retained HTML preparation</summary><HtmlPreparationReviewView raw={history.preparationReportJson} expected={history.preparationExpected}/></details>}
    <RecordedHtmlAppendedCaptureView decision={decision}/>
   </>}
  <p><a href="/editorial-preview/html-capture-history">Return to preparation selection</a></p>
  <p><a href="/editorial-preview/html-capture-sample">Inspect the separate fixed saved example</a></p>
  <p><a href="/editorial-preview/html-preparation-history">Other invented HTML preparation examples</a> · These are separate records.</p>
  <p><a href="/editorial-preview/html-initial-capture-history">Choose an initial HTML candidate with no previous publication</a></p>
  <p><a href="/editorial-preview">Back to the review desk</a></p></div>;
}
