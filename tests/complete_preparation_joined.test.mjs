import assert from 'node:assert/strict';
import test from 'node:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadTsx} from './helpers/tsx_loader.mjs';
import {completeSample,packetReport} from './helpers/complete_preparation_fixture.mjs';
import {proposalScope} from './helpers/proposal_fixture.mjs';
import {plannedMilestoneDraftJson} from '../src/planned-milestone-draft.ts';
const {CompletePreparationReadingView:View}=loadTsx(new URL('../src/complete-preparation-reading-view.tsx',import.meta.url));
const {ProposalComparisonView:Parent}=loadTsx(new URL('../src/operator-proposal-view.tsx',import.meta.url));
const render=(p,prefix='joined-overview')=>renderToStaticMarkup(View({bundleJson:p.bundleJson,milestoneJson:p.milestoneJson,context:p.context,prefix}));

test('actual joined parent and complete reader have one destination per local source field and worksheet link',()=>{
 const p=completeSample(),parent=renderToStaticMarkup(Parent({decision:{kind:'ok',report:packetReport()},selection:proposalScope()})),reading=render(p),joined=parent+reading;
 const ids=[...joined.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
 for(const [,id]of reading.matchAll(/href="#([^"]+)"/g))assert.equal(ids.filter(value=>value===id).length,1,id);
 for(const id of ['proposal-complete-preparation','proposal-evaluation-bundle','proposal-planned-milestone-preparation'])assert.equal(ids.filter(value=>value===id).length,1,id);
 assert.match(parent,/href="#proposal-complete-preparation"/);
 assert.match(reading,/Invented local population/);assert.match(reading,/Invented uncertain evaluated finding/);assert.match(reading,/Invented documented future target/);
 assert.match(reading,/2028 \(year only\)/);assert.match(reading,/2026-09 \(month only\)/);
 assert.match(reading,/Original relation: Points to a conflict/);
 assert.match(reading,/Worksheet order is not chronology/);assert.match(reading,/A target does not establish completion, delay, failure/);
});
test('bad child or invalid prefix withholds every prepared detail without malformed source echo',()=>{
 const p=completeSample();for(const name of ['bundleJson','milestoneJson']){const text=render({...p,[name]:'PRIVATE_BAD_CHILD'});assert.match(text,/overview unavailable/);assert.doesNotMatch(text,/Invented|PRIVATE_BAD_CHILD|href=|id=/);}
 for(const prefix of ['', 'x'.repeat(101),'<script>']){const text=render(p,prefix);assert.match(text,/overview unavailable/);assert.doesNotMatch(text,/Invented|<script>|href=|id=/);}
});
test('missing and supplied empty plan copies have explicit distinct nonfinding wording',()=>{
 const p=completeSample();let text=render({...p,milestoneJson:''});assert.match(text,/No milestone copy supplied/);assert.match(text,/does not establish that no plans exist/);
 p.milestones.entries=[];text=render({...p,milestoneJson:plannedMilestoneDraftJson(p.milestones,p.context)});assert.match(text,/supplied milestone copy has no entries/);assert.match(text,/not evidence that no plans exist/);
 text=render({...completeSample(),bundleJson:''});assert.match(text,/No seven-part bundle copy supplied/);assert.match(text,/Invented documented future target/);
});
test('source-derived plan text is escaped and unknown metadata stays explicitly unknown',()=>{
 const p=completeSample();p.milestones.entries[0].fields.description.wording='<script>FICTIONAL_PLAN</script>';
 const text=render({...p,milestoneJson:plannedMilestoneDraftJson(p.milestones,p.context)});
 assert.match(text,/&lt;script&gt;FICTIONAL_PLAN/);assert.doesNotMatch(text,/<script>/);
 assert.match(text,/Unknown — no value or references supplied/);assert.match(text,/not independent corroboration/);
});
test('unavailable parent comparison exposes no organizer destination or copied controls',()=>{
 const text=renderToStaticMarkup(Parent({decision:{kind:'invalid_scope'},selection:proposalScope()}));
 assert.doesNotMatch(text,/id="proposal-complete-preparation"|Private preparation overview controls|Exact separate planned-milestone JSON/);
});
