import type {Metadata} from "next";
import {notFound,unstable_rethrow} from "next/navigation";
import {captureOwnEnumerableSelectors} from "../../../src/own-enumerable-selectors.ts";
import {IssuePreparationContextView} from "../../../src/issue-preparation-context-view.tsx";
import examples from "../../../fixtures/fictional-issue-preparation-context.json";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Recorded context before preparation",robots:{index:false,follow:false}};
function selection(value:unknown):string|null|undefined{
 if(value===null||typeof value!=="object"||Array.isArray(value))return null;
 const keys=Object.keys(value);if(keys.length===0)return undefined;if(keys.length!==1||keys[0]!=="context")return null;
 const captured=captureOwnEnumerableSelectors(value,keys,true,unstable_rethrow);return captured!==null&&(captured.context==="known-base"||captured.context==="empty-head")?captured.context:null;
}
export default async function ContextSample({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 if(process.env.NODE_ENV!=="development")notFound();
 let selected:string|null|undefined;try{selected=selection(await searchParams);}catch(error){unstable_rethrow(error);selected=null;}
 const record=typeof selected==="string"?examples.cases.find(row=>row.id===selected):undefined;
 return <div className="content-page"><header className="page-intro"><p className="eyebrow">Development only / Recorded context</p><h1>Context before proposal preparation</h1><p>Choose one fixed invented observation explicitly. The development gate is not authentication. No actual backend is configured here.</p></header>
  <nav aria-label="Recorded context examples"><a href="/editorial-preview/context-sample?context=known-base">Known baseline observation</a>{" · "}<a href="/editorial-preview/context-sample?context=empty-head">Existing empty-current-head observation</a></nav>
  {selected===undefined?<p>No context is selected. Choose an example to inspect its original observation and independent expectations.</p>:<IssuePreparationContextView record={record}/>}
  {selected==="empty-head"&&<p><a href="/editorial-preview/preparation-before-storage?preparation=empty-head">Inspect the later unstored candidate prepared from this exact empty-head observation</a></p>}
  <p>These examples come from different isolated runs. They are not interchangeable context for another recorded preparation or saved composition.</p>
  <p><a href="/editorial-preview/capture-history">Inspect the separate preparation-to-composition example</a></p><p><a href="/editorial-preview">Back to the review desk</a></p></div>;
}
