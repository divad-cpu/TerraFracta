import assert from 'node:assert/strict';import test from 'node:test';
import {scopeDraftHarness} from './helpers/scope_draft_harness.mjs';
import {capturedScopeDraftContext} from '../src/server/issue-scope-draft.ts';
import {proposalReport,proposalId} from './helpers/proposal_fixture.mjs';
const field=(h,suffix)=>h.nodes().find(n=>n.props.id?.endsWith(suffix));const button=(h,text)=>h.nodes().find(n=>n.type==='button'&&n.props.children===text);
const fill=h=>{field(h,'-population-wording').props.onChange({currentTarget:{value:'Invented earlier population.'}});field(h,'-population-references').props.onChange({currentTarget:{selectedOptions:[{value:`${proposalId(3)}:1`}]}});button(h,'Review scope draft').props.onClick();};
test('scope clear and copied reopen retire old field and paste handlers before observing events',()=>{
 for(const mode of ['clear','reopen']) {
  const h=scopeDraftHarness(capturedScopeDraftContext(proposalReport()));h.mount();fill(h);
  const saved=h.nodes().find(n=>n.type==='textarea'&&n.props.readOnly).props.value;
  const old=h.nodes().filter(n=>n.type==='textarea'&&!n.props.readOnly||n.type==='select');
  button(h,'Clear scope draft').props.onClick();
  if(mode==='reopen'){field(h,'-reopen-json').props.onChange({currentTarget:{value:saved}});button(h,'Reopen scope preparation').props.onClick();}
  for(const n of old)n.props.onChange(new Proxy({}, {get(){assert.fail(`${mode}: retired event observed`);}}));
  assert.equal(field(h,'-population-wording').props.value,mode==='clear'?'':'Invented earlier population.');
  const fresh=h.nodes();fresh.find(n=>n.props.id?.endsWith('-population-wording')).props.onChange({currentTarget:{value:'Invented fresh population.'}});
  fresh.find(n=>n.props.id?.endsWith('-period-wording')).props.onChange({currentTarget:{value:'Invented fresh period.'}});
  assert.equal(field(h,'-population-wording').props.value,'Invented fresh population.');assert.equal(field(h,'-period-wording').props.value,'Invented fresh period.');h.unmount();
 }
});
test('scope file selection and installation retire preceding fields without losing physical read ownership',async()=>{
 const h=scopeDraftHarness(capturedScopeDraftContext(proposalReport()));h.mount();fill(h);const saved=h.nodes().find(n=>n.type==='textarea'&&n.props.readOnly).props.value;
 const old=field(h,'-population-wording').props.onChange;let resolve;const pending=new Promise(r=>resolve=r);
 const file=new File([saved],'invented-scope.json',{type:'application/json'});const bytes=await file.arrayBuffer();file.slice=()=>({arrayBuffer:()=>pending});
 field(h,'-file').props.onChange({currentTarget:{files:[file],value:'invented-scope.json'}});
 old(new Proxy({}, {get(){assert.fail('retired file-start event observed');}}));
 const during=field(h,'-population-wording').props.onChange;resolve(bytes);for(let i=0;i<20&&!h.nodes().some(n=>n.type==='textarea'&&n.props.readOnly);i++)await new Promise(r=>setImmediate(r));
 assert.ok(h.nodes().some(n=>n.type==='textarea'&&n.props.readOnly));during(new Proxy({}, {get(){assert.fail('retired file-install event observed');}}));assert.equal(field(h,'-population-wording').props.value,'Invented earlier population.');h.unmount();
});


test('deferred scope field merges retain same-epoch batches and refuse retired clear or reopen epochs',()=>{
 for(const mode of ['clear','reopen','same-epoch']) {
  const h=scopeDraftHarness(capturedScopeDraftContext(proposalReport()));h.mount();fill(h);
  const saved=h.nodes().find(n=>n.type==='textarea'&&n.props.readOnly).props.value;
  h.pauseMerges();const old=h.nodes();old.find(n=>n.props.id?.endsWith('-population-wording')).props.onChange({currentTarget:{value:'Invented queued population.'}});
  old.find(n=>n.props.id?.endsWith('-period-wording')).props.onChange({currentTarget:{value:'Invented queued period.'}});
  if(mode!=='same-epoch')button(h,'Clear scope draft').props.onClick();
  if(mode==='reopen'){field(h,'-reopen-json').props.onChange({currentTarget:{value:saved}});button(h,'Reopen scope preparation').props.onClick();}
  h.flushMerges();assert.equal(field(h,'-population-wording').props.value,mode==='clear'?'':mode==='reopen'?'Invented earlier population.':'Invented queued population.');
  assert.equal(field(h,'-period-wording').props.value,mode==='same-epoch'?'Invented queued period.':'');h.unmount();
 }
});
