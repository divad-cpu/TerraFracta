import { assertUnsentProposalControls } from "./helpers/inspection_controls.mjs";
import assert from 'node:assert/strict';import test from 'node:test';
import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {loadTsx} from './helpers/tsx_loader.mjs';
import {heldReasonCodes,heldCheckNames} from '../src/operator-held-decisions.ts';
import {heldReport,heldScope,heldId} from './helpers/operator_held_fixture.mjs';
import {proposalReport,proposalScope,proposalId} from './helpers/proposal_fixture.mjs';
const Held=loadTsx(new URL('../src/operator-held-decisions-view.tsx',import.meta.url)).HeldDecisionsView;
const Proposal=loadTsx(new URL('../src/operator-proposal-view.tsx',import.meta.url)).ProposalComparisonView;
const held=(decision,selection=heldScope(),reason='')=>renderToStaticMarkup(createElement(Held,{decision,selection,reason}));
const proposed=(decision,selection=proposalScope(),browseQuery)=>renderToStaticMarkup(createElement(Proposal,{decision,selection,browseQuery}));
const notice='These explanations describe recorded codes, not current findings.';
const plain=html=>html.replaceAll('&#x27;',"'").replaceAll('&amp;','&');
test('all31 existing codes receive native historical disclosures in both actually guarded views, preserving raw labels and metadata',()=>{
 for(const code of heldReasonCodes){
  const h=heldReport();h.decisions=h.decisions.slice(0,1);h.decisions[0].reasonCodes=[code];const p=proposalReport();p.decision.reasonCodes=[code];
  const hh=plain(held({kind:'ok',report:h})),pp=plain(proposed({kind:'ok',report:p}));
  for(const html of [hh,pp]){assert.ok(html.includes(notice));assert.ok(html.includes('<summary>Meaning of '+code.replaceAll('_',' ')+'</summary>'));assert.ok(html.includes('Definitions do not explain undisclosed reasons'));assert.ok(html.includes('A held decision remains held.'));}
  assert.ok(hh.includes(heldId(9)));assert.ok(hh.includes('Recorded fixed checks'));assert.ok(pp.includes('The invented share was 8.2%.'));assert.ok(pp.includes('Unverified proposal'));assert.ok(pp.includes(proposalId(8)));
 }
});
test('nullable false and true recorded fixed checks retain their separate labels without inferring conflicts or discovered sensitive data',()=>{
 for(const value of [null,false,true])for(const [reason,check,caution] of [['material_conflict','no_material_conflict','does not identify a contradiction'],['sensitive_data_present','no_sensitive_data','does not establish that sensitive data was found'],['source_version_not_current','source_version_current',"does not establish the source's present version or health"]]){
  const h=heldReport();h.decisions=h.decisions.slice(0,1);h.decisions[0].reasonCodes=[reason];h.decisions[0].checks[check]=value;
  const html=plain(held({kind:'ok',report:h}));assert.ok(html.includes(caution));assert.ok(html.includes('<dt>'+check.replaceAll('_',' ')+'</dt><dd>'+(value===null?'Not recorded':value?'Recorded true':'Recorded false')+'</dd>'));
 }
});
test('twenty-two disclosed occurrences plus two withheld entries preserve order and the existing total24 bound, without treating definitions as cleared holds',()=>{
 const codes=Array.from({length:22},(_,i)=>i%2?'sensitive_data_present':'material_conflict');const h=heldReport();h.decisions=h.decisions.slice(0,1);h.decisions[0].reasonCodes=codes;h.decisions[0].undisclosedReasonCount=2;const p=proposalReport();p.decision.reasonCodes=codes;p.decision.undisclosedReasonCount=2;
 const hh=held({kind:'ok',report:h}),pp=proposed({kind:'ok',report:p});
 for(const html of [hh,pp]){const summaries=[...html.matchAll(/<summary>Meaning of ([^<]+)<\/summary>/g)].map(x=>x[1]);assert.deepEqual(summaries,codes.map(x=>x.replaceAll('_',' ')));assert.ok(html.includes('A held decision remains held.'));}
 assert.ok(hh.includes('2 reason entries are not disclosed'));assert.ok(pp.includes('2 other reason entries are withheld'));
});
test('page filtering explains only displayed disclosed codes while withheld-only zero matches remain explicitly incomplete',()=>{
 const h=heldReport();h.decisions[1].reasonCodes=['source_not_approved'];const html=held({kind:'ok',report:h},heldScope(),'material_conflict');
 assert.ok(html.includes('Meaning of material conflict'));assert.ok(!html.includes('Meaning of source not approved'));assert.ok(html.includes('Showing 1 of 2'));
 h.decisions.forEach(row=>{row.reasonCodes=[];row.undisclosedReasonCount=1;});const zero=held({kind:'ok',report:h},heldScope(),'material_conflict');
 assert.ok(zero.includes(notice));assert.ok(!zero.includes('<summary>Meaning of'));assert.ok(zero.includes('matching decisions may be omitted'));assert.ok(zero.includes('not establish that the reason is absent'));
});
test('foreign, corrupt, unsupported-code and withheld reports disclose no explanation section or private decision details',()=>{
 for(const kind of ['invalid_scope','unconfigured','unavailable','not_found','changed']){const html=held({kind});assert.ok(!html.includes(notice));assert.ok(!html.includes('<summary>Meaning of'));assert.ok(!html.includes(heldId(9)));}
 for(const kind of ['invalid_scope','unconfigured','unavailable','not_found','capture_missing','changed']){const html=proposed({kind});assert.ok(!html.includes(notice));assert.ok(!html.includes('<summary>Meaning of'));assert.ok(!html.includes('The invented share'));}
 const h=heldReport();h.decisions[0].reasonCodes=['PRIVATE_CANARY'];const p=proposalReport();p.decision.reasonCodes=['PRIVATE_CANARY'];
 for(const html of [held({kind:'ok',report:h}),proposed({kind:'ok',report:p}),held({kind:'ok',report:heldReport()},{runId:heldId(99),cursor:null}),proposed({kind:'ok',report:proposalReport()},{runId:proposalId(99),decisionId:proposalId(2)})]){
  assert.ok(!html.includes(notice));assert.ok(!html.includes('PRIVATE_CANARY'));assert.ok(!html.includes('<summary>Meaning of'));
 }
});
test('historical passed checks remain held with inspection-only controls and the already checked return selection',()=>{
 const p=proposalReport();p.decision.reasonCodes=['qualified_checks_passed'];const browse={...proposalScope(),beforeDecidedAt:'2026-09-28T07:00:00.000001Z',beforeDecisionId:proposalId(90),reason:'qualified_checks_passed'};
 const html=plain(proposed({kind:'ok',report:p},proposalScope(),browse));assert.ok(html.includes('not a publication receipt or a current approval'));assert.ok(html.includes('Return to the selected held page (new read)'));assert.ok(html.includes('navigation only'));assertUnsentProposalControls(html);assert.ok(!html.includes('href="https://'));
 const h=heldReport();h.decisions=h.decisions.slice(0,1);h.decisions[0].reasonCodes=['qualified_checks_passed'];h.decisions[0].checks=Object.fromEntries(heldCheckNames.map(name=>[name,true]));
 const checked=held({kind:'ok',report:h},heldScope(),'qualified_checks_passed');assert.ok(checked.includes('Held ·'));assert.ok(checked.includes('Showing 1 of 1'));assert.ok(checked.includes('A held record remains held.'));assert.ok(checked.includes('method="get"'));assert.ok(!checked.includes('method="post"'));
});
