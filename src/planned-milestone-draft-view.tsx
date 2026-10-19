"use client";
import { useEffect,useId,useLayoutEffect,useRef,useState } from "react";
import { checkedResponsibilityContext } from "./responsibility-draft.ts";
import { plannedMilestoneDraftFieldLabels,plannedMilestoneDraftFromEntries,plannedMilestoneDraftJson,reopenPlannedMilestoneDraftJson,readPlannedMilestoneDraftFile,PLANNED_MILESTONE_DRAFT_BYTES,PLANNED_MILESTONE_DRAFT_ENTRIES,type PlannedMilestoneDraft,type PlannedMilestoneDraftField } from "./planned-milestone-draft.ts";
import { scopeReferenceKey,type ScopeDraftContext } from "./issue-scope-draft.ts";
import { policyEventControlEntries,preparationReferenceValues } from "./policy-event-controls.ts";
import { preparationInputIntent,type PreparationInputIntents } from "./preparation-input-intent.ts";
import { recordedProposalReferenceAnchor } from "./recorded-reference-differences.ts";
import { withLocalRequestDeadline } from "./local-request-deadline.ts";
import { preparedEventDateLabel } from "./policy-event-draft.ts";
import { cancelLocalFileRead } from "./local-file-cancellation.ts";
type Entry=PlannedMilestoneDraft["entries"][number];
type Row={id:number;initial:Entry|null;references:Record<PlannedMilestoneDraftField,string[]>;referenceHeld:Record<PlannedMilestoneDraftField,boolean>};
type Editing={key:string;generation:number;revision:number;rows:Row[];pasted:string;preview:PlannedMilestoneDraft|null;json:string|null;held:boolean};
const fields=Object.keys(plannedMilestoneDraftFieldLabels)as PlannedMilestoneDraftField[];
type Slot={released:boolean;waiters:Array<()=>void>};
const physicalFileReads=new Map<string,Slot>();
function waitForSlot(slot:Slot){return new Promise<void>(resolve=>{if(slot.released)resolve();else slot.waiters.push(resolve);});}

// Local editing only. Reuse the established ownership/intent and physical File
// slot discipline; retirement withholds content but never releases pending IO.
export function PlannedMilestoneDraftView({context:input}:{context:ScopeDraftContext}){
 const checked=checkedResponsibilityContext(input),key=checked?.key??null,prefix=useId();
 const latest=useRef({key,generation:0}),visit=useRef<object|null>(null),serial=useRef(0),revision=useRef(0),inputEpoch=useRef(0);
 const controls=useRef<HTMLFieldSetElement|null>(null),pending=useRef<AbortController|null>(null);
 const intents=useRef<PreparationInputIntents>({epoch:-1,controls:new Map()});
 const [owner,setOwner]=useState<object|null>(null),[editing,setEditing]=useState<Editing|null>(null);
 const [reading,setReading]=useState(false),[fileStatus,setFileStatus]=useState<"reading"|"held"|"busy"|"loaded"|null>(null);
 if(latest.current.key!==key){latest.current={key,generation:latest.current.generation+1};visit.current=null;}
 const generation=latest.current.generation,epoch=inputEpoch.current,frameRevision=revision.current;
 const admitted=key!==null&&owner!==null&&visit.current===owner&&editing?.key===key&&editing.generation===generation;
 const state=admitted?editing:null,shown=state?.revision===revision.current?state:null;
 const current=()=>admitted&&visit.current===owner&&latest.current.key===key&&latest.current.generation===generation;
 const ownsInput=()=>current()&&inputEpoch.current===epoch;
 const ownsAction=()=>ownsInput()&&state?.revision===revision.current;
 useLayoutEffect(()=>()=>{visit.current=null;cancelLocalFileRead(pending.current);},[]);
 useEffect(()=>{
  setFileStatus(null);
  if(key===null){visit.current=null;setOwner(null);setEditing(null);return;}
  const token={};visit.current=token;inputEpoch.current++;
  setEditing({key,generation,revision:++revision.current,rows:[],pasted:"",preview:null,json:null,held:false});setOwner(token);
  const occupied=physicalFileReads.has(key);setReading(pending.current!==null||occupied);
  if(occupied&&pending.current===null)void(async()=>{let slot:Slot|undefined;while((slot=physicalFileReads.get(key)))await waitForSlot(slot);if(visit.current===token&&pending.current===null)setReading(false);})();
  return()=>{if(visit.current===token){visit.current=null;cancelLocalFileRead(pending.current);}};
 },[key,generation]);
 if(!checked)return <section><h2>Planned-milestone preparation unavailable</h2><p>No captured milestone worksheet is shown.</p></section>;
 const context=checked.context,claims=context.claims.map((claim,index)=>({...claim,statementNumber:index+1})).filter(claim=>claim.type==="policy_action"||claim.type==="delivery");
 const choices=context.claims.flatMap((claim,statementIndex)=>claim.evidence.map((source,index)=>({key:scopeReferenceKey(claim.id,index+1),href:`#${recordedProposalReferenceAnchor("proposed",claim.id,index)}`,label:`Proposed statement ${statementIndex+1} · reference ${index+1}: ${source.title} · ${source.locator} · original role: ${source.relation}`})));
 const choiceKeys=new Set(choices.map(choice=>choice.key));
 function newRow(initial:Entry|null):Row{return{id:++serial.current,initial,references:Object.fromEntries(fields.map(field=>[field,initial?.fields[field]?.references.map(ref=>scopeReferenceKey(ref.claimId,ref.referenceNumber))??[]]))as Row["references"],referenceHeld:Object.fromEntries(fields.map(field=>[field,false]))as Row["referenceHeld"]};}
 function replace(rows:Row[],pasted="",preview:PlannedMilestoneDraft|null=null,json:string|null=null){
  if(!ownsAction()||key===null||rows.length>PLANNED_MILESTONE_DRAFT_ENTRIES)return;
  inputEpoch.current++;const next=++revision.current;cancelLocalFileRead(pending.current);if(!current())return;setFileStatus(null);
  setEditing(old=>current()?{key,generation,revision:next,rows,pasted,preview,json,held:false}:old);
 }
 function changed(){if(!ownsInput())return;const next=++revision.current;cancelLocalFileRead(pending.current);if(!current())return;setFileStatus(null);setEditing(old=>current()&&old?{...old,revision:next,preview:null,json:null,held:false}:old);}
 function clear(){if(!ownsInput()||frameRevision!==revision.current||key===null)return;inputEpoch.current++;const next=++revision.current;cancelLocalFileRead(pending.current);if(!current())return;setFileStatus(null);setEditing(old=>current()?{key,generation,revision:next,rows:[],pasted:"",preview:null,json:null,held:false}:old);}
 function changeReferences(id:number,field:PlannedMilestoneDraftField,event:{readonly currentTarget:HTMLSelectElement}){
  const owns=preparationInputIntent(intents,epoch,`${id}:${field}:references`,ownsInput);if(!owns)return;
  const next=++revision.current;cancelLocalFileRead(pending.current);if(!owns())return;setFileStatus(null);
  try{const target=event.currentTarget;if(!owns())return;const values=preparationReferenceValues(target,owns);if(!owns())return;if(new Set(values).size!==values.length||values.some(value=>!choiceKeys.has(value)))throw Error();
   setEditing(old=>owns()&&old?{...old,revision:next,rows:old.rows.map(row=>row.id===id?{...row,references:{...row.references,[field]:values},referenceHeld:{...row.referenceHeld,[field]:false}}:row),preview:null,json:null,held:false}:old);
  }catch{setEditing(old=>owns()&&old?{...old,revision:next,rows:old.rows.map(row=>row.id===id?{...row,referenceHeld:{...row.referenceHeld,[field]:true}}:row),preview:null,json:null,held:true}:old);}
 }
 function review(){
  if(!ownsAction())return;const operation=++revision.current,owns=()=>current()&&inputEpoch.current===epoch&&revision.current===operation;
  cancelLocalFileRead(pending.current);if(!owns())return;setFileStatus(null);
  try{if(state!.rows.some(row=>fields.some(field=>row.referenceHeld[field])))throw Error();const root=controls.current;if(!root||!owns())throw Error();
   const data=policyEventControlEntries(root,owns);if(!owns())return;const preview=plannedMilestoneDraftFromEntries(data,state!.rows.map(row=>row.id),context),json=preview?plannedMilestoneDraftJson(preview,context):null;
   if(!owns())return;setEditing(old=>owns()&&old?{...old,revision:operation,preview:json===null?null:preview,json,held:json===null}:old);
  }catch{setEditing(old=>owns()&&old?{...old,revision:operation,preview:null,json:null,held:true}:old);}
 }
 function reopen(){if(!ownsAction()||!state)return;const candidate=reopenPlannedMilestoneDraftJson(state.pasted,context);if(!ownsAction())return;if(candidate)replace(candidate.entries.map(newRow),state.pasted,candidate,plannedMilestoneDraftJson(candidate,context));else{const next=++revision.current;setEditing(old=>ownsInput()&&revision.current===next&&old?{...old,revision:next,preview:null,json:null,held:true}:old);}}
 async function selectFile(file:File|undefined,malformed=false){
  if(!ownsAction()||key===null)return;const operation=++revision.current;inputEpoch.current++;const owns=()=>current()&&revision.current===operation;
  cancelLocalFileRead(pending.current);if(!owns())return;
  if(malformed){setEditing(old=>owns()&&old?{...old,revision:operation,preview:null,json:null,held:false}:old);setFileStatus("held");return;}
  setEditing(old=>owns()&&old?{...old,revision:operation,rows:[],pasted:"",preview:null,json:null,held:false}:old);setFileStatus(null);
  if(!file)return;
  if(pending.current!==null||physicalFileReads.has(key)){setFileStatus("busy");return;}
  const slot:Slot={released:false,waiters:[]};physicalFileReads.set(key,slot);let controller:AbortController|null=null;
  try{
   controller=new AbortController();if(!owns()){cancelLocalFileRead(controller);return;}pending.current=controller;setReading(true);setFileStatus("reading");
   const candidate=await withLocalRequestDeadline(controller.signal,8000,async signal=>{
    const observe=<T,>(get:()=>T):T=>{if(signal.aborted||!owns())throw Error();const value=get();if(signal.aborted||!owns())throw Error();return value;};
    const size=observe(()=>file.size);if(!Number.isSafeInteger(size)||size<2||size>PLANNED_MILESTONE_DRAFT_BYTES)throw Error();
    const slice=observe(()=>file.slice),chunk=Reflect.apply(slice,file,[0,PLANNED_MILESTONE_DRAFT_BYTES+1])as Blob;if(signal.aborted||!owns())throw Error();
    const read=observe(()=>chunk.arrayBuffer),bytes=await Reflect.apply(read,chunk,[])as ArrayBuffer;if(signal.aborted||!owns())throw Error();
    const value=readPlannedMilestoneDraftFile(bytes,size,context);if(signal.aborted||!owns()||value===null)throw Error();return value;
   },undefined,()=>{cancelLocalFileRead(controller);if(owns())setFileStatus("held");});
   if(owns()){inputEpoch.current++;const next=++revision.current;setEditing(old=>current()?{key,generation,revision:next,rows:candidate.entries.map(newRow),pasted:"",preview:candidate,json:plannedMilestoneDraftJson(candidate,context),held:false}:old);setFileStatus("loaded");}
  }catch{if(owns())setFileStatus("held");}
  finally{if(physicalFileReads.get(key)===slot)physicalFileReads.delete(key);slot.released=true;for(const release of slot.waiters.splice(0))release();if(controller!==null&&pending.current===controller){pending.current=null;if(visit.current!==null)setReading(false);}}
 }
 return <details className="issue-scope-preparation"><summary>Prepare unsent planned-milestone details</summary><h2>Planned-milestone preparation</h2>
  <p>Describe a documented future target as a plan. A target date does not establish adoption, completion, delay, failure or a causal effect. The source-described institution is not inferred from the current government.</p>
  <p>The description is required. Leave other fields unknown by clearing both value and references. Keep target time separate from reporting time; preserve exact day, month, year or stated-period precision. No day is guessed from a year and no date is filled from retrieval time.</p>
  <p>Each supplied field needs its own exact captured references. Their original roles do not establish support for new wording. This private draft records no accepted review, creates no publication candidate and leaves the existing six-slot packet unchanged.</p>
  {!claims.length?<p>No proposed policy-or-action or delivery statement is available in this captured comparison. Other types are not converted into plans.</p>:<>
   <fieldset ref={controls} aria-label="Unsent planned-milestone controls" disabled={!admitted} onChange={changed}>
    {state?.rows.map((row,index)=><fieldset key={row.id}><legend>Planned milestone {index+1}</legend>
     <label htmlFor={`${prefix}-${row.id}-claim`}>Associated proposed policy-or-action or delivery statement</label>
     <select id={`${prefix}-${row.id}-claim`} name={`${row.id}.claim`} defaultValue={row.initial?.claimId??""}><option value="">Choose a statement</option>{claims.map(claim=><option key={claim.id} value={claim.id}>Proposed statement {claim.statementNumber} · {claim.periodLabel}</option>)}</select>
     {fields.map(field=>{const value=row.initial?.fields[field],date=field==="targetDate"||field==="reportedDate",stem=field==="targetDate"?"target":"reported";return <div key={field}>
      {date?<>
       <label htmlFor={`${prefix}-${row.id}-${field}-precision`}>{plannedMilestoneDraftFieldLabels[field]} — precision</label>
       <select id={`${prefix}-${row.id}-${field}-precision`} name={`${row.id}.${stem}Precision`} defaultValue={value&&"date"in value?value.date.precision:""}>
        <option value="">Unknown</option><option value="day">Exact day</option><option value="month">Month only</option><option value="year">Year only</option><option value="period">Stated period</option>
       </select>
       <label htmlFor={`${prefix}-${row.id}-${field}-value`}>{plannedMilestoneDraftFieldLabels[field]} — value</label>
       <input id={`${prefix}-${row.id}-${field}-value`} type="text" name={`${row.id}.${stem}Value`} maxLength={2400} defaultValue={value&&"date"in value?("value"in value.date?value.date.value:"label"in value.date?value.date.label:""):""}/>
      </>:<><label htmlFor={`${prefix}-${row.id}-${field}`}>{plannedMilestoneDraftFieldLabels[field]}{field==="description"?" (required)":""}</label>
       <textarea id={`${prefix}-${row.id}-${field}`} name={`${row.id}.${field}`} maxLength={2400} defaultValue={value&&"wording"in value?value.wording:""}/></>}
      <label htmlFor={`${prefix}-${row.id}-${field}-refs`}>References for {plannedMilestoneDraftFieldLabels[field]}</label>
      <select id={`${prefix}-${row.id}-${field}-refs`} name={`${row.id}.${field}References`} multiple size={Math.max(1,Math.min(4,choices.length))} value={row.references[field]} onChange={event=>changeReferences(row.id,field,event)} aria-invalid={shown&&row.referenceHeld[field]||undefined}>
       {choices.map(choice=><option key={choice.key} value={choice.key}>{choice.label}</option>)}
      </select>{shown&&row.referenceHeld[field]&&<p role="status">Reference selection held. Choose up to twelve distinct recorded references explicitly.</p>}
     </div>;})}
     <button type="button" onClick={()=>replace(state.rows.filter(value=>value.id!==row.id))}>Remove milestone entry {index+1}</button>
    </fieldset>)}
    <button type="button" disabled={!admitted||(state?.rows.length??0)>=PLANNED_MILESTONE_DRAFT_ENTRIES} onClick={()=>{if(ownsAction()&&state&&state.rows.length<PLANNED_MILESTONE_DRAFT_ENTRIES)replace([...state.rows,newRow(null)]);}}>Add milestone entry</button>
    <button type="button" disabled={!admitted} onClick={review}>Inspect unsent milestone draft</button><button type="button" disabled={!admitted} onClick={clear}>Clear milestone draft</button>
   </fieldset>
   {shown?.held&&<p role="status">Milestone preparation held. Supply a description, an associated policy-or-action or delivery statement, valid original date precision, distinct exact references for every supplied field, no duplicate entries and at most eight entries within the complete 16 KiB UTF-8 limit. Previous preview is withheld.</p>}
   {shown?.preview&&shown.json!==null&&<section><h3>Unsent planned-milestone draft</h3><p>Worksheet order is not chronology. These are source-described unverified preparations. They are not completed events or accepted reviews.</p><ol>{shown.preview.entries.map((entry,index)=><li key={index}><a href={`#proposal-proposed-claim-${entry.claimId}`}>Inspect associated proposed statement</a><dl>{fields.map(field=>{const value=entry.fields[field];return <div key={field}><dt>{plannedMilestoneDraftFieldLabels[field]}</dt><dd>{value===null?"Unknown — no value or references supplied":<><p>{"date"in value?preparedEventDateLabel(value.date):value.wording}</p><ul>{value.references.map(ref=>{const choice=choices.find(choice=>choice.key===scopeReferenceKey(ref.claimId,ref.referenceNumber))!;return <li key={choice.key}><a href={choice.href}>{choice.label}</a></li>;})}</ul></>}</dd></div>;})}</dl></li>)}</ol>
    <label htmlFor={`${prefix}-json`}>Exact milestone preparation JSON — copy manually</label><textarea id={`${prefix}-json`} readOnly rows={12} value={shown.json}/></section>}
   <label htmlFor={`${prefix}-paste`}>Paste exact saved milestone preparation</label><textarea id={`${prefix}-paste`} maxLength={PLANNED_MILESTONE_DRAFT_BYTES} value={state?.pasted??""} disabled={!admitted} onChange={event=>{const owns=preparationInputIntent(intents,epoch,"pasted-milestone",ownsInput);if(!owns)return;const value=event.currentTarget.value;if(!owns())return;const next=++revision.current;cancelLocalFileRead(pending.current);if(!owns())return;setFileStatus(null);setEditing(old=>owns()&&old?{...old,revision:next,pasted:value,preview:null,json:null,held:false}:old);}}/>
   <button type="button" disabled={!admitted} onClick={reopen}>Reopen milestone preparation</button>
   <label htmlFor={`${prefix}-file`}>Open a separate local milestone JSON file</label><input id={`${prefix}-file`} type="file" accept=".json,application/json" disabled={!admitted||reading} onChange={event=>{if(!ownsAction())return;try{const target=event.currentTarget;if(!ownsAction())return;const files=target.files;if(!ownsAction())return;const file=files?.[0];if(!ownsAction())return;target.value="";if(!ownsAction())return;void selectFile(file);}catch{void selectFile(undefined,true);}}}/>
   <p>The selected file is read locally, at most 16 KiB of exact UTF-8 JSON. Filenames are not displayed. It must match this exact captured comparison.</p><div role="status" aria-live="polite" aria-busy={reading}>{admitted&&fileStatus==="reading"&&<p>Checking the selected milestone file…</p>}{admitted&&fileStatus==="held"&&<p>Milestone file unavailable or invalid. Previous preview is withheld.</p>}{admitted&&fileStatus==="loaded"&&<p>Separate milestone file opened. It remains unverified and editable.</p>}{admitted&&fileStatus==="busy"&&<p>Previous file read still finishing. Choose the file again after it settles.</p>}{reading&&fileStatus!=="reading"&&<p>The previous file check is still finishing. Wait before choosing another file.</p>}</div>
  </>}
 </details>;
}
