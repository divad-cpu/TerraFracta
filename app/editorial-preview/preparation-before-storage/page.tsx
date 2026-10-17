import type {Metadata} from "next";
import {notFound,unstable_rethrow} from "next/navigation";
import {captureOwnEnumerableSelectors} from "../../../src/own-enumerable-selectors.ts";
import {UnstoredPreparationView} from "../../../src/unstored-preparation-view.tsx";
import example from "../../../fixtures/fictional-unstored-preparation.json";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Recorded preparation before storage",robots:{index:false,follow:false}};
function selection(value:unknown):string|null|undefined{
 if(value===null||typeof value!=="object"||Array.isArray(value))return null;
 const keys=Object.keys(value);if(keys.length===0)return undefined;if(keys.length!==1||keys[0]!=="preparation")return null;
 const captured=captureOwnEnumerableSelectors(value,keys,true,unstable_rethrow);return captured?.preparation==="empty-head"?"empty-head":null;
}
export default async function UnstoredPreparationSample({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 if(process.env.NODE_ENV!=="development")notFound();
 let selected:string|null|undefined;try{selected=selection(await searchParams);}catch(error){unstable_rethrow(error);selected=null;}
 return <div className="content-page"><header className="page-intro"><p className="eyebrow">Development only / Unstored preparation</p><h1>Inspect a candidate before storage</h1><p>One fixed invented pure result. The development gate is not authentication. No actual backend is configured here.</p></header>
  <p><a href="/editorial-preview/preparation-before-storage?preparation=empty-head">Inspect the explicitly selected empty-head preparation</a></p>
  {selected===undefined?<p>No preparation is selected. Choose the recorded example to inspect its original four parts and context.</p>:<UnstoredPreparationView record={selected==="empty-head"?example:undefined}/>}
  <p><a href="/editorial-preview/context-sample?context=empty-head">Inspect the same earlier empty-head context observation</a>. This later pure preparation retained that observation.</p>
  <p><a href="/editorial-preview/initial-capture-sample">Inspect a separate saved initial-candidate example</a>. That example contains different records.</p>
  <p><a href="/editorial-preview/preparation-history">Inspect other stored preparation examples</a>. Those are different records.</p>
  <p><a href="/editorial-preview">Back to the review desk</a></p></div>;
}
