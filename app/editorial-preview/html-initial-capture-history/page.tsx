import type {Metadata} from "next";
import {notFound,unstable_rethrow} from "next/navigation";
import {parseHtmlInitialRecordedCaptureQuery,htmlInitialRecordedCaptureHref as href} from "../../../src/html-initial-recorded-capture-navigation.ts";
import {parseHtmlInitialCandidateCaptureLookup} from "../../../src/server/html-initial-candidate-lookup.ts";
import {resolveRecordedHtmlInitialCaptureHistory} from "../../../src/server/recorded-html-initial-capture-history.ts";
import {RecordedHtmlInitialCaptureView} from "../../../src/recorded-html-initial-capture-view.tsx";
import {HtmlPreparationReviewView} from "../../../src/html-preparation-review-view.tsx";
import history from "../../../fixtures/fictional-html-initial-capture-history.json";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Choose an illustrative initial HTML candidate",robots:{index:false,follow:false}};
export default async function HtmlInitialCaptureHistory({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 if(process.env.NODE_ENV!=="development")notFound();
 let query:ReturnType<typeof parseHtmlInitialRecordedCaptureQuery>;
 try{query=parseHtmlInitialRecordedCaptureQuery(await searchParams,unstable_rethrow);}catch(error){unstable_rethrow(error);query={kind:"invalid"};}
 let decision:Awaited<ReturnType<typeof resolveRecordedHtmlInitialCaptureHistory>>|null=null;
 if(query.kind==="selected"&&query.preparationId===history.preparationId){try{
  const lookupRaw=Buffer.from(history.lookupJson,"utf8"),choices=parseHtmlInitialCandidateCaptureLookup(lookupRaw,history.preparationReportJson,history.preparationExpected,history.lookupObservedAt);
  let record=null;
  if(query.captureId!==null&&choices.matches.some(row=>row.captureId===query.captureId))record=(await import("../../../fixtures/fictional-html-initial-capture.json")).default;
  decision=await resolveRecordedHtmlInitialCaptureHistory({preparationId:query.preparationId,captureId:query.captureId,preparationReportJson:history.preparationReportJson,preparationExpected:history.preparationExpected,lookupRaw,lookupObservedAt:history.lookupObservedAt,captureObservedAt:history.captureObservedAt,record});
 }catch(error){unstable_rethrow(error);decision={kind:"unavailable"};}}
 return <div className="content-page"><header className="page-intro"><p className="eyebrow">Development only / Illustrative initial HTML continuation</p><h1>HTML preparation to first saved candidate</h1><p>Two explicit choices demonstrate the empty-head branch. All records are generated and invented. The development gate is not authentication.</p></header>
  {query.kind==="none"?<section><h2>Choose the initial HTML preparation</h2><p>No first or newest record is selected automatically.</p><p><a href={href(history.preparationId)}>Inspect this preparation and its candidate choices</a></p></section>:decision===null?<section role="status"><h2>Selected initial HTML continuation unavailable</h2><p>No private preparation, source passage or candidate contents are displayed.</p></section>:<>
   {decision.kind==="choice_required"&&<details><summary>Inspect this separate unverified preparation</summary><HtmlPreparationReviewView raw={history.preparationReportJson} expected={history.preparationExpected}/></details>}<RecordedHtmlInitialCaptureView decision={decision}/>
  </>}
  <p><a href="/editorial-preview/html-initial-capture-history">Return to preparation selection</a></p><p><a href="/editorial-preview/html-capture-history">Inspect the separate known-base HTML example</a></p><p><a href="/editorial-preview">Back to the review desk</a></p>
 </div>;
}
