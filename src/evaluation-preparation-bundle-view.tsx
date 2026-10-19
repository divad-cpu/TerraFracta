"use client";
import { EvaluationPreparationReadingView } from "./evaluation-preparation-reading-view.tsx";
import { useEffect,useId,useLayoutEffect,useRef,useState } from "react";
import { checkedResponsibilityContext } from "./responsibility-draft.ts";
import type { ScopeDraftContext } from "./issue-scope-draft.ts";
import { preparationInputIntent,type PreparationInputIntents } from "./preparation-input-intent.ts";
import { cancelLocalFileRead } from "./local-file-cancellation.ts";
import { withLocalRequestDeadline } from "./local-request-deadline.ts";
import { preparationPacketLabels,PREPARATION_PACKET_BYTES } from "./preparation-packet.ts";
import { EVALUATION_DRAFT_BYTES } from "./evaluation-draft.ts";
import { evaluationPreparationBundleFromParts,evaluationPreparationBundleJson,reopenEvaluationPreparationBundleJson,readEvaluationPreparationBundleFile,inspectEvaluationPreparationBundle,EVALUATION_BUNDLE_BYTES,type EvaluationPreparationBundle } from "./evaluation-preparation-bundle.ts";
type Parts={preparationPacket:string;evaluation:string};
type Editing={key:string;generation:number;revision:number;parts:Parts;pasted:string;preview:EvaluationPreparationBundle|null;json:string|null;held:boolean};
type Slot={released:boolean;waiters:Array<()=>void>};
const physicalBundleReads=new Map<string,Slot>();
const waitForSlot=(slot:Slot)=>new Promise<void>(resolve=>{if(slot.released)resolve();else slot.waiters.push(resolve);});
const empty=():Parts=>({preparationPacket:"",evaluation:""});
const labels={preparationPacket:"Exact existing six-slot preparation packet JSON",evaluation:"Exact separate evaluation preparation JSON"}as const;
const statusLabels={not_supplied:"Not supplied",empty:"Supplied empty entry list",supplied:"Supplied editing material"}as const;

// Distinct private transport of exact child strings. Never scrape worksheets,
// migrate the legacy format, upload files or infer review from editing counts.
export function EvaluationPreparationBundleView({context:input}:{context:ScopeDraftContext|null}){
 const checked=checkedResponsibilityContext(input),key=checked?.key??null,prefix=useId();
 const latest=useRef({key,generation:0}),visit=useRef<object|null>(null),revision=useRef(0),inputEpoch=useRef(0),pending=useRef<AbortController|null>(null);
 const intents=useRef<PreparationInputIntents>({epoch:-1,controls:new Map()});
 const [owner,setOwner]=useState<object|null>(null),[editing,setEditing]=useState<Editing|null>(null),[reading,setReading]=useState(false);
 const [fileStatus,setFileStatus]=useState<"reading"|"waiting"|"held"|"loaded"|null>(null);
 if(latest.current.key!==key){latest.current={key,generation:latest.current.generation+1};visit.current=null;}
 const generation=latest.current.generation,epoch=inputEpoch.current,frameRevision=revision.current;
 const admitted=key!==null&&owner!==null&&visit.current===owner&&editing?.key===key&&editing.generation===generation;
 const state=admitted?editing:null,shown=state?.revision===revision.current?state:null;
 const current=()=>admitted&&visit.current===owner&&latest.current.key===key&&latest.current.generation===generation;
 const ownsInput=()=>current()&&inputEpoch.current===epoch;
 const ownsAction=()=>ownsInput()&&state?.revision===revision.current;
 useLayoutEffect(()=>()=>{visit.current=null;cancelLocalFileRead(pending.current);},[]);
 useEffect(()=>{
  setFileStatus(null);setOwner(null);setEditing(null);
  if(key===null){visit.current=null;setReading(false);return;}
  const token={};visit.current=token;const slotKey='evaluation_bundle:'+key;
  const live=()=>visit.current===token&&latest.current.key===key&&latest.current.generation===generation;
  const admit=()=>{if(!live())return;inputEpoch.current++;setReading(false);setFileStatus(null);setEditing({key,generation,revision:++revision.current,parts:empty(),pasted:"",preview:null,json:null,held:false});setOwner(token);};
  if(!physicalBundleReads.has(slotKey))admit();
  else{setReading(true);setFileStatus("waiting");void(async()=>{let slot:Slot|undefined;while((slot=physicalBundleReads.get(slotKey)))await waitForSlot(slot);admit();})();}
  return()=>{if(visit.current===token){visit.current=null;cancelLocalFileRead(pending.current);}};
 },[key,generation]);
 if(!checked)return <section><h2>Evaluation bundle unavailable</h2><p>No captured bundle or copied preparation is shown.</p></section>;
 const context=checked.context;
 function edit(name:keyof Parts|"pasted",event:{readonly currentTarget:HTMLTextAreaElement}){
  const owns=preparationInputIntent(intents,epoch,name,ownsInput);if(!owns)return;
  const value=event.currentTarget.value;if(!owns())return;const next=++revision.current;cancelLocalFileRead(pending.current);if(!owns())return;setFileStatus(null);
  setEditing(old=>owns()&&old?{...old,revision:next,...(name==='pasted'?{pasted:value}:{parts:{...old.parts,[name]:value}}),preview:null,json:null,held:false}:old);
 }
 function review(){
  if(!ownsAction()||!state)return;const operation=++revision.current,owns=()=>current()&&inputEpoch.current===epoch&&revision.current===operation;
  cancelLocalFileRead(pending.current);if(!owns())return;setFileStatus(null);
  const preview=evaluationPreparationBundleFromParts({preparationPacket:state.parts.preparationPacket===""?null:state.parts.preparationPacket,evaluation:state.parts.evaluation===""?null:state.parts.evaluation},context),json=preview?evaluationPreparationBundleJson(preview,context):null;
  if(!owns())return;setEditing(old=>owns()&&old?{...old,revision:operation,preview:json===null?null:preview,json,held:json===null}:old);
 }
 function install(value:EvaluationPreparationBundle,json:string){
  if(key===null)return;inputEpoch.current++;const next=++revision.current;
  setEditing(old=>current()?{key,generation,revision:next,parts:{preparationPacket:value.preparations.preparationPacket??"",evaluation:value.preparations.evaluation??""},pasted:json,preview:value,json,held:false}:old);
 }
 function reopen(){
  if(!ownsAction()||!state)return;const operation=++revision.current,owns=()=>current()&&inputEpoch.current===epoch&&revision.current===operation;
  cancelLocalFileRead(pending.current);if(!owns())return;setFileStatus(null);
  const value=reopenEvaluationPreparationBundleJson(state.pasted,context);if(!owns())return;
  if(value)install(value,state.pasted);else setEditing(old=>owns()&&old?{...old,revision:operation,preview:null,json:null,held:true}:old);
 }
 function clear(){if(!ownsInput()||frameRevision!==revision.current||key===null)return;inputEpoch.current++;const next=++revision.current;cancelLocalFileRead(pending.current);if(!current())return;setFileStatus(null);setEditing(old=>current()?{key,generation,revision:next,parts:empty(),pasted:"",preview:null,json:null,held:false}:old);}
 async function selectFile(file:File|undefined,malformed=false){
  if(!ownsAction()||key===null)return;const operation=++revision.current;inputEpoch.current++;const owns=()=>current()&&revision.current===operation;
  cancelLocalFileRead(pending.current);if(!owns())return;
  // A failed selector or invalid file cannot destroy unfinished child text.
  setEditing(old=>owns()&&old?{...old,revision:operation,preview:null,json:null,held:false}:old);setFileStatus(null);
  if(malformed){setFileStatus("held");return;}if(!file)return;
  const slotKey='evaluation_bundle:'+key;if(pending.current!==null||physicalBundleReads.has(slotKey)){setFileStatus("waiting");return;}
  const slot:Slot={released:false,waiters:[]};physicalBundleReads.set(slotKey,slot);let controller:AbortController|null=null;
  try{
   controller=new AbortController();if(!owns()){cancelLocalFileRead(controller);return;}pending.current=controller;setReading(true);setFileStatus("reading");
   const value=await withLocalRequestDeadline(controller.signal,8000,async signal=>{
    const observe=<T,>(get:()=>T):T=>{if(signal.aborted||!owns())throw Error();const value=get();if(signal.aborted||!owns())throw Error();return value;};
    const size=observe(()=>file.size);if(!Number.isSafeInteger(size)||size<2||size>EVALUATION_BUNDLE_BYTES)throw Error();
    const slice=observe(()=>file.slice),chunk=Reflect.apply(slice,file,[0,EVALUATION_BUNDLE_BYTES+1])as Blob;if(signal.aborted||!owns())throw Error();
    const read=observe(()=>chunk.arrayBuffer),bytes=await Reflect.apply(read,chunk,[])as ArrayBuffer;if(signal.aborted||!owns())throw Error();
    const value=readEvaluationPreparationBundleFile(bytes,size,context);if(signal.aborted||!owns()||value===null)throw Error();return value;
   },undefined,()=>{cancelLocalFileRead(controller);if(owns())setFileStatus("held");});
   if(owns()){const json=evaluationPreparationBundleJson(value,context);if(json===null)throw Error();install(value,json);setFileStatus("loaded");}
  }catch{if(owns())setFileStatus("held");}
  finally{if(physicalBundleReads.get(slotKey)===slot)physicalBundleReads.delete(slotKey);slot.released=true;for(const release of slot.waiters.splice(0))release();if(controller!==null&&pending.current===controller){pending.current=null;if(visit.current!==null)setReading(false);}}
 }
 const inspected=shown?.preview?inspectEvaluationPreparationBundle(shown.preview,context):null;
 return <details className="issue-scope-preparation"><summary>Keep a separate evaluation preparation bundle</summary><h2>Separate evaluation bundle</h2>
  <p>This distinct private format carries the exact existing six-slot v1 packet text and a separate optional evaluation preparation. The old six-slot format and its limits remain unchanged; it does not accept an evaluation slot. At least one valid child is required. A missing child remains absent.</p>
  <p>Paste copied text explicitly. This view does not read other worksheets automatically, merge or rewrite their children. Exact bytes must belong to this captured comparison. Editable copied JSON and field counts establish no factual support, evaluator independence, review, approval or publication.</p>
  <p>Up to 192 KiB of complete UTF-8 bundle JSON after framing; each child's original byte limit still applies. Keep copied files private. Clear or closing does not remove copies outside this view. Nothing is uploaded, archived, submitted or published.</p>
  <fieldset disabled={!admitted} aria-label="Separate evaluation bundle controls">
   {(Object.keys(labels)as Array<keyof Parts>).map(name=><div key={name}><label htmlFor={`${prefix}-${name}`}>{labels[name]} — optional</label><textarea id={`${prefix}-${name}`} rows={8} maxLength={name==='evaluation'?EVALUATION_DRAFT_BYTES:PREPARATION_PACKET_BYTES} value={state?.parts[name]??""} disabled={!admitted} onChange={event=>edit(name,event)}/></div>)}
   <button type="button" disabled={!admitted} onClick={review}>Review separate evaluation bundle</button><button type="button" disabled={!admitted} onClick={clear}>Clear separate evaluation bundle</button>
  </fieldset>
  {shown?.held&&<p role="status">Bundle held. Check each exact child format and comparison binding, at least one supplied child, and the complete UTF-8 byte limit. Previous preview is withheld. Entered child text remains.</p>}
  {inspected&&shown?.json!==null&&shown?.json!==undefined&&<section><h3>Unsent bundle contents</h3><p>Editing counts only. Supplied fields may be wrong; unknown fields stay unknown. These are not readiness, quality or approval scores.</p>
   <dl>{inspected.preparationPacket===null?<div><dt>Existing six-slot packet</dt><dd>Not supplied</dd></div>:inspected.preparationPacket.map(row=><div key={row.part}><dt>{preparationPacketLabels[row.part]}</dt><dd>{statusLabels[row.status]} · {row.entries} editing entries · {row.suppliedFields} supplied fields · {row.unknownFields} unknown fields</dd></div>)}
    <div><dt>Separate evaluation preparation</dt><dd>{inspected.evaluation===null?'Not supplied':`${inspected.evaluation.entries} editing entries · ${inspected.evaluation.suppliedFields} supplied fields · ${inspected.evaluation.unknownFields} unknown fields`}</dd></div>
   </dl><EvaluationPreparationReadingView bundle={shown.preview} context={context} prefix={`${prefix}-reading`}/><label htmlFor={`${prefix}-json`}>Exact separate bundle JSON — copy manually</label><textarea id={`${prefix}-json`} readOnly rows={12} value={shown.json}/></section>}
  <label htmlFor={`${prefix}-paste`}>Paste exact saved separate bundle JSON</label><textarea id={`${prefix}-paste`} maxLength={EVALUATION_BUNDLE_BYTES} rows={8} value={state?.pasted??""} disabled={!admitted} onChange={event=>edit('pasted',event)}/>
  <button type="button" disabled={!admitted} onClick={reopen}>Reopen separate evaluation bundle</button>
  <label htmlFor={`${prefix}-file`}>Open a local separate bundle file</label><input id={`${prefix}-file`} type="file" accept=".json,application/json" disabled={!admitted||reading} onChange={event=>{if(!ownsAction())return;try{const target=event.currentTarget;if(!ownsAction())return;const files=target.files;if(!ownsAction())return;const file=files?.[0];if(!ownsAction())return;target.value='';if(!ownsAction())return;void selectFile(file);}catch{void selectFile(undefined,true);}}}/>
  <p>The file stays local. Only bounded exact UTF-8 JSON is inspected; filenames are not displayed. Successful explicit reopening replaces both child input strings with the exact saved originals.</p>
  <div role="status" aria-live="polite" aria-busy={reading}>{fileStatus==='waiting'&&<p>Previous bundle file read still finishing. Wait for its physical settlement before choosing again.</p>}{admitted&&fileStatus==='reading'&&<p>Checking the selected separate bundle file…</p>}{admitted&&fileStatus==='held'&&<p>Separate bundle file unavailable or invalid. Child text is retained and previous preview withheld.</p>}{admitted&&fileStatus==='loaded'&&<p>Separate bundle file opened. Its editable contents remain unverified.</p>}{reading&&fileStatus!=='reading'&&fileStatus!=='waiting'&&<p>The previous physical file read retains its slot. Cancellation does not start another read.</p>}</div>
 </details>;
}
