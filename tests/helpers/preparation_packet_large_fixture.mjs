import assert from 'node:assert/strict';
import {scopeDraftJson} from '../../src/issue-scope-draft.ts';
import {responsibilityDraftJson} from '../../src/responsibility-draft.ts';
import {policyEventDraftJson} from '../../src/policy-event-draft.ts';
import {fundingDraftJson} from '../../src/funding-draft.ts';
import {indicatorDraftJson} from '../../src/indicator-draft.ts';
import {deliveryDraftJson} from '../../src/delivery-draft.ts';


// Retained independent valid-parts expansion witness, adapted to relative
// project imports so the regression travels with the future source tree.
export function largePacketParts(context) {
const bytes=value=>new TextEncoder().encode(value).byteLength;
const claim=type=>context.claims.find(item=>item.type===type).id;
const references=context.claims.flatMap(item=>item.evidence.map((_source,index)=>({claimId:item.id,referenceNumber:index+1})));
assert.equal(references.length,12);
const ref=type=>[{claimId:claim(type),referenceNumber:1}];
const base=(kind)=>({schemaVersion:1,kind,binding:context.binding});
const rich={
 scope:n=>({...base('issue_scope_preparation'),fields:Object.fromEntries(['population','period','selectionRationale'].map((key,i)=>
  [key,{wording:String(i)+'\\'.repeat(n),references:ref('condition')}]))}),
 responsibility:n=>({...base('responsibility_preparation'),entries:Array.from({length:8},(_,i)=>({claimId:claim('policy_action'),
  fields:Object.fromEntries(['institution','governmentLevel','role','period'].map(key=>
   [key,{wording:String(i)+'\\'.repeat(n),references:ref('policy_action')}]))}))}),
 policyEvents:n=>({...base('policy_event_preparation'),entries:Array.from({length:8},(_,i)=>({claimId:claim('policy_action'),
  fields:{kind:{value:'announcement',references:ref('policy_action')},description:{wording:String(i)+'\\'.repeat(n),references:ref('policy_action')},eventDate:null,reportedDate:null}}))}),
 funding:(n,k)=>({...base('funding_preparation'),entries:Array.from({length:4},(_,i)=>({claimId:claim('funding'),fields:{
  stage:{value:'announced',references:references.slice(0,k)},amount:{value:String(100+i),references:references.slice(0,k)},
  currency:{value:'NOK',references:references.slice(0,k)},scale:{value:'units',references:references.slice(0,k)},
  financialPeriod:{value:String(i)+'\\'.repeat(n),references:references.slice(0,k)},priceBasis:{value:'nominal',references:references.slice(0,k)},
  priceBasePeriod:{value:String(i)+'\\'.repeat(n),references:references.slice(0,k)},coverage:{value:'single_period',references:references.slice(0,k)},
  revisionRelation:{value:'additional',references:references.slice(0,k)},
 }}))}),
 indicators:n=>({...base('indicator_preparation'),entries:Array.from({length:4},(_,i)=>({claimId:claim('condition'),fields:{
  ...Object.fromEntries(['sourceSeries','definition','definitionVersion','unit','geography','population','denominator','adjustment','frequency','observationPeriod','vintage']
   .map(key=>[key,{value:String(i)+'\\'.repeat(n),references:ref('condition')}])),value:null,missingReason:null,
 }}))}),
 delivery:n=>({...base('delivery_preparation'),entries:Array.from({length:8},(_,i)=>({claimId:claim('delivery'),fields:{
  stage:{value:'pilot',references:ref('delivery')},description:{wording:String(i)+'\\'.repeat(n),references:ref('delivery')},
  coverage:{wording:String(i)+'\\'.repeat(n),references:ref('delivery')},eventDate:null,reportedDate:null,
 }}))}),
};
const codecs={scope:scopeDraftJson,responsibility:responsibilityDraftJson,policyEvents:policyEventDraftJson,
 funding:fundingDraftJson,indicators:indicatorDraftJson,delivery:deliveryDraftJson};
function best(part,params,max){
 let choice=null;
 for(const param of params){
  let lo=0,hi=max;
  while(lo<hi){const mid=Math.ceil((lo+hi)/2),draft=part==='funding'?rich[part](mid,param):rich[part](mid);
   if(codecs[part](draft,context)!==null)lo=mid;else hi=mid-1;}
  const draft=part==='funding'?rich[part](lo,param):rich[part](lo),copy=codecs[part](draft,context);
  if(copy===null)continue;
  const escapedBytes=bytes(JSON.stringify(copy));
  if(!choice||escapedBytes>choice.escapedBytes)choice={param,n:lo,copy,escapedBytes};
 }
 assert.ok(choice,part);return choice;
}
const choices={
 scope:best('scope',[1],1199),responsibility:best('responsibility',[1],1199),policyEvents:best('policyEvents',[1],1199),
 funding:best('funding',Array.from({length:12},(_,i)=>i+1),239),indicators:best('indicators',[1],239),
 delivery:best('delivery',[1],1199),
};
const parts=Object.fromEntries(Object.entries(choices).map(([part,choice])=>[part,choice.copy]));
return parts;
}
