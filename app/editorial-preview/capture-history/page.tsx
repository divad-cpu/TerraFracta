import type { Metadata } from "next";
import { notFound,unstable_rethrow } from "next/navigation";
import { parseRecordedCaptureQuery,recordedCaptureHref } from "../../../src/recorded-capture-navigation.ts";
import { resolveRecordedAppendedCapture } from "../../../src/server/recorded-appended-capture.ts";
import { RecordedAppendedCaptureView } from "../../../src/recorded-appended-capture-view.tsx";
import { DetachedPreparationView } from "../../../src/detached-preparation-view.tsx";
import history from "../../../fixtures/fictional-recorded-capture-history.json";
import saved from "../../../fixtures/fictional-appended-capture.json";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Recorded invented composition choices",robots:{index:false,follow:false}};
export default async function CaptureHistory({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 if(process.env.NODE_ENV!=="development")notFound();
 let query:ReturnType<typeof parseRecordedCaptureQuery>;
 try{query=parseRecordedCaptureQuery(await searchParams,unstable_rethrow);}catch(error){unstable_rethrow(error);query={kind:"invalid"};}
 const decision=query.kind!=="selected"||query.preparationId!==history.preparationId?null:await resolveRecordedAppendedCapture({preparationId:query.preparationId,captureId:query.captureId,
  preparationReportJson:history.preparationReportJson,preparationExpected:history.preparationExpected,lookupRaw:Buffer.from(history.lookupJson,"utf8"),observedAt:history.observedAt,
  record:query.captureId===null?null:{retainedIntentJson:saved.retainedIntentJson,rawReceiptJson:saved.rawReceiptJson,actualComparisonJson:JSON.stringify(saved.actualComparison)}});
 return <div className="content-page"><header className="page-intro"><p className="eyebrow">Development only / Explicit recorded continuation</p><h1>Preparation to saved composition</h1>
  <p>One fixed invented preparation and its separate saved composition. The development gate is not authentication, and these records remain unpublished.</p></header>
  {query.kind==="none"?<section><h2>Choose the recorded preparation</h2><p>Choose a preparation first; its capture is never selected automatically.</p><p><code>{history.preparationId}</code></p>
   <p><a href={recordedCaptureHref(history.preparationId)}>Inspect this recorded preparation and its composition choices</a></p></section>:decision===null?<section role="status"><h2>Selected continuation unavailable</h2><p>The requested selection could not be matched. No private preparation or composition details are displayed.</p></section>:<>
    {decision.kind==="choice_required"&&<details><summary>Inspect the separately retained original preparation</summary><DetachedPreparationView raw={history.preparationReportJson} expected={history.preparationExpected}/></details>}
    <RecordedAppendedCaptureView decision={decision}/>
   </>}
  <p><a href="/editorial-preview/capture-history">Return to preparation selection</a></p><p><a href="/editorial-preview/capture-sample">Inspect the separate fixed saved example</a></p><p><a href="/editorial-preview/context-sample">Inspect separate recorded context examples</a> · These observations belong to different runs.</p>
  <p><a href="/editorial-preview/preparation-history">Other invented preparation history</a> · This separate example contains different preparation records.</p>
  <p><a href="/editorial-preview">Back to the review desk</a></p></div>;
}
