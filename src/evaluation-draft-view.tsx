"use client";
import { useEffect,useId,useLayoutEffect,useRef,useState } from "react";
import { checkedResponsibilityContext } from "./responsibility-draft.ts";
import { evaluationFieldLabels,evaluationDraftFromEntries,evaluationDraftJson,reopenEvaluationDraftJson,readEvaluationDraftFile,EVALUATION_DRAFT_BYTES,EVALUATION_DRAFT_ENTRIES,evaluationDraftFeedbackFromEntries,type EvaluationDraftFeedback,type EvaluationDraft,type EvaluationField } from "./evaluation-draft.ts";
import { scopeReferenceKey,type ScopeDraftContext } from "./issue-scope-draft.ts";
import { policyEventControlEntries,preparationReferenceValues } from "./policy-event-controls.ts";
import { preparationInputIntent,type PreparationInputIntents } from "./preparation-input-intent.ts";
import { recordedProposalReferenceAnchor } from "./recorded-reference-differences.ts";
import { withLocalRequestDeadline } from "./local-request-deadline.ts";
import { cancelLocalFileRead } from "./local-file-cancellation.ts";
type Entry=EvaluationDraft["entries"][number];
type Row={id:number;initial:Entry|null;references:Record<EvaluationField,string[]>;referenceHeld:Record<EvaluationField,boolean>};
type Editing={key:string;generation:number;revision:number;rows:Row[];pasted:string;preview:EvaluationDraft|null;json:string|null;held:boolean};
const fields=Object.keys(evaluationFieldLabels)as EvaluationField[];
type Slot={released:boolean;waiters:Array<()=>void>};
const physicalFileReads=new Map<string,Slot>();
function waitForSlot(slot:Slot){return new Promise<void>(resolve=>{if(slot.released)resolve();else slot.waiters.push(resolve);});}

// Local editing only. Reuse the established ownership/intent and physical File
// slot discipline; retirement withholds content but never releases pending IO.
export function EvaluationDraftView({context:input}:{context:ScopeDraftContext}){
 const checked=checkedResponsibilityContext(input),key=checked?.key??null,prefix=useId();
 const latest=useRef({key,generation:0}),visit=useRef<object|null>(null),serial=useRef(0),revision=useRef(0),inputEpoch=useRef(0);
 const controls=useRef<HTMLFieldSetElement|null>(null),pending=useRef<AbortController|null>(null);
 const intents=useRef<PreparationInputIntents>({epoch:-1,controls:new Map()});
 const [owner,setOwner]=useState<object|null>(null),[editing,setEditing]=useState<Editing|null>(null);
 const [heldFeedback,setHeldFeedback]=useState<{key:string|null;generation:number;revision:number;value:EvaluationDraftFeedback|null}|null>(null);
 const [reading,setReading]=useState(false),[fileStatus,setFileStatus]=useState<"reading"|"held"|"busy"|"loaded"|null>(null);
 if(latest.current.key!==key){latest.current={key,generation:latest.current.generation+1};visit.current=null;}
 const generation=latest.current.generation,epoch=inputEpoch.current,frameRevision=revision.current;
 const admitted=key!==null&&owner!==null&&visit.current===owner&&editing?.key===key&&editing.generation===generation;
 const state=admitted?editing:null,shown=state?.revision===revision.current?state:null;
 const hints=shown?.held&&heldFeedback?.key===key&&heldFeedback.generation===generation&&heldFeedback.revision===revision.current?heldFeedback.value:null;
 const current=()=>admitted&&visit.current===owner&&latest.current.key===key&&latest.current.generation===generation;
 const ownsInput=()=>current()&&inputEpoch.current===epoch;
 const ownsAction=()=>ownsInput()&&state?.revision===revision.current;
 useLayoutEffect(()=>()=>{visit.current=null;cancelLocalFileRead(pending.current);},[]);
 useEffect(()=>{
  setFileStatus(null);setHeldFeedback(null);
  if(key===null){visit.current=null;setOwner(null);setEditing(null);return;}
  const token={};visit.current=token;inputEpoch.current++;
  setEditing({key,generation,revision:++revision.current,rows:[],pasted:"",preview:null,json:null,held:false});setOwner(token);
  const occupied=physicalFileReads.has(key);setReading(pending.current!==null||occupied);
  if(occupied&&pending.current===null)void(async()=>{let slot:Slot|undefined;while((slot=physicalFileReads.get(key)))await waitForSlot(slot);if(visit.current===token&&pending.current===null)setReading(false);})();
  return()=>{if(visit.current===token){visit.current=null;cancelLocalFileRead(pending.current);}};
 },[key,generation]);
 if(!checked)return <section><h2>Evaluation preparation unavailable</h2><p>No captured evaluation worksheet is shown.</p></section>;
 const context=checked.context,claims=context.claims.map((claim,index)=>({...claim,statementNumber:index+1})).filter(claim=>claim.type==="evaluation");
 const choices=context.claims.flatMap((claim,statementIndex)=>claim.evidence.map((source,index)=>({key:scopeReferenceKey(claim.id,index+1),href:`#${recordedProposalReferenceAnchor("proposed",claim.id,index)}`,label:`Proposed statement ${statementIndex+1} · reference ${index+1}: ${source.title} · ${source.locator} · original role: ${source.relation}`})));
 const choiceKeys=new Set(choices.map(choice=>choice.key));
 function newRow(initial:Entry|null):Row{return{id:++serial.current,initial,references:Object.fromEntries(fields.map(field=>[field,initial?.fields[field]?.references.map(ref=>scopeReferenceKey(ref.claimId,ref.referenceNumber))??[]]))as Row["references"],referenceHeld:Object.fromEntries(fields.map(field=>[field,false]))as Row["referenceHeld"]};}
 function replace(rows:Row[],pasted="",preview:EvaluationDraft|null=null,json:string|null=null){
  if(!ownsAction()||key===null||rows.length>EVALUATION_DRAFT_ENTRIES)return;
  inputEpoch.current++;const next=++revision.current;cancelLocalFileRead(pending.current);if(!current())return;setFileStatus(null);setHeldFeedback(null);
  setEditing(old=>current()?{key,generation,revision:next,rows,pasted,preview,json,held:false}:old);
 }
 function changed(){if(!ownsInput())return;const next=++revision.current;cancelLocalFileRead(pending.current);if(!current())return;setFileStatus(null);setHeldFeedback(null);setEditing(old=>current()&&old?{...old,revision:next,preview:null,json:null,held:false}:old);}
 function clear(){if(!ownsInput()||frameRevision!==revision.current||key===null)return;inputEpoch.current++;const next=++revision.current;cancelLocalFileRead(pending.current);if(!current())return;setFileStatus(null);setHeldFeedback(null);setEditing(old=>current()?{key,generation,revision:next,rows:[],pasted:"",preview:null,json:null,held:false}:old);}
 function changeReferences(id:number,field:EvaluationField,event:{readonly currentTarget:HTMLSelectElement}){
  const owns=preparationInputIntent(intents,epoch,`${id}:${field}:references`,ownsInput);if(!owns)return;
  const next=++revision.current;cancelLocalFileRead(pending.current);if(!owns())return;setFileStatus(null);setHeldFeedback(null);
  try{const target=event.currentTarget;if(!owns())return;const values=preparationReferenceValues(target,owns);if(!owns())return;if(new Set(values).size!==values.length||values.some(value=>!choiceKeys.has(value)))throw Error();
   setEditing(old=>owns()&&old?{...old,revision:next,rows:old.rows.map(row=>row.id===id?{...row,references:{...row.references,[field]:values},referenceHeld:{...row.referenceHeld,[field]:false}}:row),preview:null,json:null,held:false}:old);
  }catch{setEditing(old=>owns()&&old?{...old,revision:next,rows:old.rows.map(row=>row.id===id?{...row,referenceHeld:{...row.referenceHeld,[field]:true}}:row),preview:null,json:null,held:true}:old);}
 }
 function review(){
  if(!ownsAction())return;const operation=++revision.current,owns=()=>current()&&inputEpoch.current===epoch&&revision.current===operation;
  cancelLocalFileRead(pending.current);if(!owns())return;setFileStatus(null);setHeldFeedback(null);
  try{if(state!.rows.some(row=>fields.some(field=>row.referenceHeld[field])))throw Error();const root=controls.current;if(!root||!owns())throw Error();
   const data=policyEventControlEntries(root,owns);if(!owns())return;const preview=evaluationDraftFromEntries(data,state!.rows.map(row=>row.id),context),json=preview?evaluationDraftJson(preview,context):null;
   const feedback=json===null?evaluationDraftFeedbackFromEntries(data,state!.rows.map(row=>row.id),context):null;
   if(!owns())return;setHeldFeedback({key,generation,revision:operation,value:feedback});setEditing(old=>owns()&&old?{...old,revision:operation,preview:json===null?null:preview,json,held:json===null}:old);
  }catch{setEditing(old=>owns()&&old?{...old,revision:operation,preview:null,json:null,held:true}:old);}
 }
 function reopen(){if(!ownsAction()||!state)return;setHeldFeedback(null);const candidate=reopenEvaluationDraftJson(state.pasted,context);if(!ownsAction())return;if(candidate)replace(candidate.entries.map(newRow),state.pasted,candidate,evaluationDraftJson(candidate,context));else{const next=++revision.current;setEditing(old=>ownsInput()&&revision.current===next&&old?{...old,revision:next,preview:null,json:null,held:true}:old);}}
 async function selectFile(file:File|undefined,malformed=false){
  if(!ownsAction()||key===null)return;const operation=++revision.current;inputEpoch.current++;const owns=()=>current()&&revision.current===operation;
  cancelLocalFileRead(pending.current);if(!owns())return;
  if(malformed){setHeldFeedback(null);setEditing(old=>owns()&&old?{...old,revision:operation,preview:null,json:null,held:false}:old);setFileStatus("held");return;}
  setEditing(old=>owns()&&old?{...old,revision:operation,rows:[],pasted:"",preview:null,json:null,held:false}:old);setFileStatus(null);setHeldFeedback(null);
  if(!file)return;
  if(pending.current!==null||physicalFileReads.has(key)){setFileStatus("busy");return;}
  const slot:Slot={released:false,waiters:[]};physicalFileReads.set(key,slot);let controller:AbortController|null=null;
  try{
   controller=new AbortController();if(!owns()){cancelLocalFileRead(controller);return;}pending.current=controller;setReading(true);setFileStatus("reading");
   const candidate=await withLocalRequestDeadline(controller.signal,8000,async signal=>{
    const observe=<T,>(get:()=>T):T=>{if(signal.aborted||!owns())throw Error();const value=get();if(signal.aborted||!owns())throw Error();return value;};
    const size=observe(()=>file.size);if(!Number.isSafeInteger(size)||size<2||size>EVALUATION_DRAFT_BYTES)throw Error();
    const slice=observe(()=>file.slice),chunk=Reflect.apply(slice,file,[0,EVALUATION_DRAFT_BYTES+1])as Blob;if(signal.aborted||!owns())throw Error();
    const read=observe(()=>chunk.arrayBuffer),bytes=await Reflect.apply(read,chunk,[])as ArrayBuffer;if(signal.aborted||!owns())throw Error();
    const value=readEvaluationDraftFile(bytes,size,context);if(signal.aborted||!owns()||value===null)throw Error();return value;
   },undefined,()=>{cancelLocalFileRead(controller);if(owns())setFileStatus("held");});
   if(owns()){inputEpoch.current++;const next=++revision.current;setEditing(old=>current()?{key,generation,revision:next,rows:candidate.entries.map(newRow),pasted:"",preview:candidate,json:evaluationDraftJson(candidate,context),held:false}:old);setFileStatus("loaded");}
  }catch{if(owns())setFileStatus("held");}
  finally{if(physicalFileReads.get(key)===slot)physicalFileReads.delete(key);slot.released=true;for(const release of slot.waiters.splice(0))release();if(controller!==null&&pending.current===controller){pending.current=null;if(visit.current!==null)setReading(false);}}
 }
 return <details className="issue-scope-preparation"><summary>Prepare unsent evaluation details</summary><h2>Evaluation preparation</h2>
  <p>Record what an identified evaluation says about its finding, design and limitations. Observed change after a measure does not establish a causal effect. An evaluator's name does not establish independence, and a design label does not establish validity. Preserve the source's uncertainty and vague periods; no grade, effect size, confidence or causal verdict is calculated.</p>
  <p>Private, editable, unauthenticated and unsent. Each supplied field needs 1–12 distinct exact references in this captured comparison, with wording up to 1,200 characters after trimming. Original support, conflict or context roles do not approve this interpretation. Blank fields remain unknown, not evidence of no limitation or no effect.</p>
  <p>Save evaluation preparation separately. The existing six-slot preparation packet is unchanged and does not accept this worksheet. Nothing is submitted, uploaded, archived or published; copied files remain outside this view after Clear or closing.</p>
  {!claims.length?<p>No proposed evaluation statement is available. Other statement types are not converted into causal findings.</p>:<>
   <fieldset ref={controls} disabled={!admitted} aria-label="Unsent evaluation controls" onChange={changed}>
    {state?.rows.map((row,index)=>{const hint=hints?.entries[index];return <fieldset key={row.id}><legend>Evaluation entry {index+1}</legend>
     <label htmlFor={`${prefix}-${row.id}-claim`}>Associated proposed evaluation statement</label><select id={`${prefix}-${row.id}-claim`} name={`${row.id}.claim`} defaultValue={row.initial?.claimId??""} aria-invalid={hint?.statement||undefined} aria-describedby={hint?.statement?`${prefix}-${row.id}-statement-error`:undefined}><option value="">Choose a statement</option>{claims.map(claim=><option key={claim.id} value={claim.id}>Proposed statement {claim.statementNumber} · {claim.periodLabel}</option>)}</select>
     {hint?.statement&&<p id={`${prefix}-${row.id}-statement-error`}>Choose an associated evaluation statement from this captured comparison. Other statement types are not converted.</p>}
     {fields.map(field=><div key={field}><label htmlFor={`${prefix}-${row.id}-${field}`}>{evaluationFieldLabels[field]}</label><textarea id={`${prefix}-${row.id}-${field}`} name={`${row.id}.${field}`} maxLength={2400} defaultValue={row.initial?.fields[field]?.wording??""} aria-invalid={hint?.fields[field].wording||undefined} aria-describedby={hint?.fields[field].wording?`${prefix}-${row.id}-${field}-wording-error`:undefined}/>
      {hint?.fields[field].wording&&<p id={`${prefix}-${row.id}-${field}-wording-error`}>Supply nonblank wording of at most 1,200 characters, or clear both wording and references to leave this field unknown.</p>}
      <label htmlFor={`${prefix}-${row.id}-${field}-refs`}>References for {evaluationFieldLabels[field]}</label><select id={`${prefix}-${row.id}-${field}-refs`} name={`${row.id}.${field}References`} multiple size={Math.max(1,Math.min(4,choices.length))} value={row.references[field]} onChange={event=>changeReferences(row.id,field,event)} aria-invalid={hint?.fields[field].references||shown&&row.referenceHeld[field]||undefined} aria-describedby={hint?.fields[field].references?`${prefix}-${row.id}-${field}-references-error`:undefined}>
       {choices.map(choice=><option key={choice.key} value={choice.key}>{choice.label}</option>)}
      </select>{hint?.fields[field].references&&<p id={`${prefix}-${row.id}-${field}-references-error`}>Choose 1–12 distinct exact captured references for this supplied wording, or clear both wording and references to leave it unknown. A reference choice does not approve its meaning.</p>}{shown&&row.referenceHeld[field]&&<p role="status">Reference selection held. Previous choices remain; choose up to twelve distinct recorded references explicitly.</p>}</div>)}
     {hint?.duplicate&&<p id={`${prefix}-${row.id}-duplicate-error`}>This entry repeats an earlier complete entry. Remove the duplicate or correct the intended description explicitly.</p>}
     <button id={`${prefix}-${row.id}-remove`} type="button" onClick={()=>replace(state.rows.filter(value=>value.id!==row.id))}>Remove evaluation entry {index+1}</button>
    </fieldset>;})}
    <button type="button" disabled={!admitted||(state?.rows.length??0)>=EVALUATION_DRAFT_ENTRIES} onClick={()=>{if(ownsAction()&&state&&state.rows.length<EVALUATION_DRAFT_ENTRIES)replace([...state.rows,newRow(null)]);}}>Add evaluation entry</button>
    <button type="button" disabled={!admitted} onClick={review}>Review evaluation draft</button><button type="button" disabled={!admitted} onClick={clear}>Clear evaluation draft</button>
   </fieldset>
   {shown?.held&&<p role="status">{hints?.size==="copy"?"The complete copied preparation exceeds the 16 KiB UTF-8 limit. Individual valid fields are not marked wrong; shorten wording or reduce references before reviewing again.":hints?.size==="input"?"The collected editing input exceeds its 16 KiB UTF-8 limit. Reduce the supplied input before reviewing again.":hints?.tooMany?"Keep at most four evaluation entries.":"Evaluation preparation held. Check the evaluation statement, bounded wording, distinct exact references and complete 16 KiB UTF-8 limit. Previous preview is withheld."}</p>}
   {hints&&hints.entries.some(row=>row.statement||row.duplicate||Object.values(row.fields).some(field=>field.wording||field.references))&&<ul aria-label="Evaluation field corrections">{state?.rows.flatMap((row,index)=>{const hint=hints.entries[index];if(!hint)return[];return[
    hint.statement&&<li key={`${row.id}-statement`}><a href={`#${prefix}-${row.id}-claim`}>Entry {index+1}: choose the associated evaluation statement</a></li>,
    hint.duplicate&&<li key={`${row.id}-duplicate`}><a href={`#${prefix}-${row.id}-remove`}>Entry {index+1}: remove or correct the duplicate entry</a></li>,
    ...fields.flatMap(field=>[hint.fields[field].wording&&<li key={`${row.id}-${field}-wording`}><a href={`#${prefix}-${row.id}-${field}`}>Entry {index+1}: correct wording for {evaluationFieldLabels[field]}</a></li>,hint.fields[field].references&&<li key={`${row.id}-${field}-references`}><a href={`#${prefix}-${row.id}-${field}-refs`}>Entry {index+1}: correct references for {evaluationFieldLabels[field]}</a></li>])];})}</ul>}
   {shown?.preview&&shown.json!==null&&<section><h3>Unsent evaluation draft</h3><p>Worksheet order is not chronology. These are source-described unverified preparations, not a finding by TerraFracta.</p><ol>{shown.preview.entries.map((entry,index)=><li key={index}><a href={`#proposal-proposed-claim-${entry.claimId}`}>Inspect associated proposed statement</a><dl>{fields.map(field=><div key={field}><dt>{evaluationFieldLabels[field]}</dt><dd>{entry.fields[field]===null?"Unknown — no wording or references supplied":<><p>{entry.fields[field].wording}</p><ul>{entry.fields[field].references.map(ref=>{const choice=choices.find(choice=>choice.key===scopeReferenceKey(ref.claimId,ref.referenceNumber))!;return <li key={choice.key}><a href={choice.href}>{choice.label}</a></li>;})}</ul></>}</dd></div>)}</dl></li>)}</ol>
    <label htmlFor={`${prefix}-json`}>Exact evaluation preparation JSON — copy manually</label><textarea id={`${prefix}-json`} readOnly rows={12} value={shown.json}/></section>}
   <label htmlFor={`${prefix}-paste`}>Paste exact saved evaluation preparation</label><textarea id={`${prefix}-paste`} maxLength={EVALUATION_DRAFT_BYTES} value={state?.pasted??""} disabled={!admitted} onChange={event=>{const owns=preparationInputIntent(intents,epoch,"pasted-evaluation",ownsInput);if(!owns)return;const value=event.currentTarget.value;if(!owns())return;const next=++revision.current;cancelLocalFileRead(pending.current);if(!owns())return;setFileStatus(null);setHeldFeedback(null);setEditing(old=>owns()&&old?{...old,revision:next,pasted:value,preview:null,json:null,held:false}:old);}}/>
   <button type="button" disabled={!admitted} onClick={reopen}>Reopen evaluation preparation</button>
   <label htmlFor={`${prefix}-file`}>Open a separate local evaluation JSON file</label><input id={`${prefix}-file`} type="file" accept=".json,application/json" disabled={!admitted||reading} onChange={event=>{if(!ownsAction())return;try{const target=event.currentTarget;if(!ownsAction())return;const files=target.files;if(!ownsAction())return;const file=files?.[0];if(!ownsAction())return;target.value="";if(!ownsAction())return;void selectFile(file);}catch{void selectFile(undefined,true);}}}/>
   <p>The selected file is read locally, at most 16 KiB of exact UTF-8 JSON. Filenames are not displayed. It must match this exact captured comparison.</p><div role="status" aria-live="polite" aria-busy={reading}>{admitted&&fileStatus==="reading"&&<p>Checking the selected evaluation file…</p>}{admitted&&fileStatus==="held"&&<p>Evaluation file unavailable or invalid. Previous preview is withheld.</p>}{admitted&&fileStatus==="loaded"&&<p>Separate evaluation file opened. It remains unverified and editable.</p>}{admitted&&fileStatus==="busy"&&<p>Previous file read still finishing. Choose the file again after it settles.</p>}{reading&&fileStatus!=="reading"&&<p>The previous file check is still finishing. Wait before choosing another file.</p>}</div>
  </>}
 </details>;
}
