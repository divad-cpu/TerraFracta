import type {Metadata} from "next";
import {notFound,unstable_rethrow} from "next/navigation";
import {captureOwnEnumerableSelectors} from "../../../src/own-enumerable-selectors.ts";
import {resolveRecordedInitialCaptureHistory} from "../../../src/server/recorded-initial-capture-history.ts";
import {RecordedInitialCaptureHistoryView} from "../../../src/recorded-initial-capture-history-view.tsx";
import example from "../../../fixtures/fictional-initial-capture-history.json";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Recorded initial preparation and capture choices",robots:{index:false,follow:false}};
function selection(input:unknown):{preparationId:string;captureId:string|null}|null|undefined{
 if(input===null||typeof input!=="object"||Array.isArray(input))return null;const keys=Object.keys(input);if(keys.length===0)return undefined;
 if(!keys.includes("preparation")||keys.some(k=>k!=="preparation"&&k!=="capture"))return null;
 const value=captureOwnEnumerableSelectors(input,keys,true,unstable_rethrow);if(value===null||value.preparation!==example.preparationId||keys.includes("capture")&&value.capture!==example.captureId)return null;
 return {preparationId:example.preparationId,captureId:keys.includes("capture")?example.captureId:null};
}
export default async function InitialCaptureHistory({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 if(process.env.NODE_ENV!=="development")notFound();let selected:ReturnType<typeof selection>;
 try{selected=selection(await searchParams);}catch(error){unstable_rethrow(error);selected=null;}
 const decision=selected===undefined?undefined:selected===null?{kind:"invalid_scope" as const}:await resolveRecordedInitialCaptureHistory({preparationId:selected.preparationId,captureId:selected.captureId,preparationReportJson:example.preparationReportJson,preparationExpected:example.preparationExpected,lookupRaw:Buffer.from(example.lookupJson,"utf8"),lookupObservedAt:example.lookupObservedAt,captureObservedAt:example.captureObservedAt,get record(){return example.record;}});
 return <div className="content-page"><header className="page-intro"><p className="eyebrow">Development only / Recorded initial continuation</p><h1>Choose a preparation, then its saved initial candidate</h1><p>One fixed invented local record. The development gate is not authentication. No actual backend is configured here.</p></header>
  <p>Recorded preparation: <code>{example.preparationId}</code>. <a href={`/editorial-preview/initial-capture-history?preparation=${example.preparationId}`}>Choose this exact preparation</a></p>
  {decision===undefined?<p>No preparation is selected. Choose the recorded preparation before inspecting its candidate metadata or private passages.</p>:<RecordedInitialCaptureHistoryView decision={decision}/>}
  <p><a href="/editorial-preview/initial-capture-sample">Inspect a separate saved initial-candidate example</a>. It contains different records.</p>
  <p><a href="/editorial-preview/capture-history">Inspect the separate whole-issue composition example</a>.</p><p><a href="/editorial-preview">Back to the review desk</a></p></div>;
}
