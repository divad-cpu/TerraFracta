import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {renderToStaticMarkup} from 'react-dom/server';import {loadTsx} from './helpers/tsx_loader.mjs';
const {IssuePreparationContextView:View}=loadTsx(new URL('../src/issue-preparation-context-view.tsx',import.meta.url)),records=()=>JSON.parse(readFileSync(new URL('../fixtures/fictional-issue-preparation-context.json',import.meta.url),'utf8')).cases;
const render=record=>renderToStaticMarkup(View({record})),sha=s=>createHash('sha256').update(s).digest('hex');
test('known baseline shows distinct exact observations source identity and both original/canonical fingerprints',t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No request'));const r=records()[0],html=render(r),raw=JSON.parse(r.rawEnvelopeJson).matches[0].baselineJson;
 for(const text of ['Observed issue context before preparation','Explicit held candidate','Historical revision','Baseline title','Retained after-read UTC observation','not assignment, factual support','No editorial action is available',r.trustedObservedAt,sha(raw)]){assert.ok(html.includes(text),text);}
 const codes=[...html.matchAll(/<code>([a-f0-9]{64})<\/code>/g)].map(m=>m[1]);assert.ok(codes.length>=3);assert.doesNotMatch(html,/<form|<button|<input|href="https?:/);
 const ids=[...html.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length);for(const m of html.matchAll(/href="#([^"]+)"/g))assert.ok(ids.includes(m[1]),m[1]);
});
test('empty current head is a physical-row observation with no fabricated baseline or historical absence',()=>{
 const html=render(records()[1]);for(const text of ['existing publication-head row','No baseline was selected or fabricated','does not mean that the issue has never had a publication','does not examine publication history','No claim, preparation store, capture or work lease is created'])assert.ok(html.includes(text),text);assert.doesNotMatch(html,/Baseline title|Historical revision|Original stored baseline|<form|<button|<input/);
});
test('unpaired known baseline is explicitly distinguished from an independently matched head',()=>{
 const r=records()[0];r.expected.head=null;const html=render(r);assert.match(html,/No independent head fingerprint was supplied/);assert.doesNotMatch(html,/match the independently supplied head expectation|both current fields empty/);
});
test('failed admission withholds every private body source and baseline field',()=>{
 const r=records()[0];r.rawEnvelopeJson='PRIVATE_CANARY';const html=render(r);assert.match(html,/Recorded preparation context unavailable/);assert.doesNotMatch(html,/PRIVATE_CANARY|Held decision recorded|Baseline title|Item key|Original content fingerprint/);
});
test('valid no-match remains distinct from malformed data and never asserts an empty row',()=>{
 const r=records()[1],native=JSON.parse(r.rawEnvelopeJson);native.matches=[];r.rawEnvelopeJson=JSON.stringify(native);const html=render(r);assert.match(html,/No matching recorded context/);assert.match(html,/not an observed empty head/);assert.doesNotMatch(html,/both current fields empty|Source version|Item key/);
});
test('coherently supplied baseline markup remains escaped text with no external source links',()=>{
 const r=records()[0],v=JSON.parse(r.rawEnvelopeJson),b=JSON.parse(v.matches[0].baselineJson);b.snapshot.title='<img src=x onerror=alert(1)> Invented title';v.matches[0].baselineJson=JSON.stringify(b);v.matches[0].issue.head.content_sha256=sha(v.matches[0].baselineJson);if(r.expected.head!==null)r.expected.head.contentSha256=v.matches[0].issue.head.content_sha256;r.rawEnvelopeJson=JSON.stringify(v);const html=render(r);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img|href="https?:|onerror="/);
});

test('canonical baseline fingerprint matches the independently computed Python fixture expectation',()=>{
 const html=render(records()[0]);assert.ok(html.includes('ad728c9ad732b51bddc72eaf83ff4424a352577ada50d31a2c4728de60aaf4ca'));
});
