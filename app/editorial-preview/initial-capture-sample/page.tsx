import type {Metadata} from "next";
import {notFound,unstable_rethrow} from "next/navigation";
import {captureOwnEnumerableSelectors} from "../../../src/own-enumerable-selectors.ts";
import {InitialCandidateCaptureView} from "../../../src/initial-candidate-capture-view.tsx";
import example from "../../../fixtures/fictional-initial-candidate-capture.json";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Recorded initial candidate and provenance",robots:{index:false,follow:false}};
function selection(value:unknown):string|null|undefined{
 if(value===null||typeof value!=="object"||Array.isArray(value))return null;
 const keys=Object.keys(value);if(keys.length===0)return undefined;if(keys.length!==1||keys[0]!=="capture")return null;
 const selected=captureOwnEnumerableSelectors(value,keys,true,unstable_rethrow);return selected!==null&&selected.capture===example.id?example.id:null;
}
export default async function InitialCaptureSample({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 if(process.env.NODE_ENV!=="development")notFound();
 let selected:string|null|undefined;try{selected=selection(await searchParams);}catch(error){unstable_rethrow(error);selected=null;}
 return <div className="content-page"><header className="page-intro"><p className="eyebrow">Development only / Saved initial candidate</p><h1>Inspect a saved initial candidate</h1><p>One fixed invented saved record and its separate original comparison. The development gate is not authentication. No actual backend is configured here.</p></header>
  <p>Recorded capture: <code>{example.id}</code>. <a href={`/editorial-preview/initial-capture-sample?capture=${example.id}`}>Inspect this explicitly selected saved candidate</a></p>
  {selected===undefined?<p>No saved candidate is selected. Choose the recorded capture before any private preparation or passage is shown.</p>:<InitialCandidateCaptureView record={selected===example.id?example:undefined}/>}
  <p><a href="/editorial-preview/preparation-before-storage">Inspect a separate unstored preparation example</a>. That example contains different records.</p>
  <p><a href="/editorial-preview/capture-history">Inspect the separate known-baseline composition example</a>. It retains a different whole-issue intent.</p>
  <p><a href="/editorial-preview/initial-capture-history">Choose a preparation and its initial candidate in a separate recorded example</a>. It contains different records.</p>
  <p><a href="/editorial-preview">Back to the review desk</a></p></div>;
}
