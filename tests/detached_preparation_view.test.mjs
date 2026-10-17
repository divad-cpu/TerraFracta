import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {renderToStaticMarkup} from 'react-dom/server';import {loadTsx} from './helpers/tsx_loader.mjs';import {canonicalProposalJson as canonical} from '../src/operator-proposal-capture.ts';
const raw=()=>readFileSync(new URL('../fixtures/fictional-detached-preparation.json',import.meta.url),'utf8');
const expected=()=>JSON.parse(readFileSync(new URL('../fixtures/fictional-detached-preparation-expected.json',import.meta.url),'utf8'));
const {DetachedPreparationView}=loadTsx(new URL('../src/detached-preparation-view.tsx',import.meta.url));
const render=(body=raw(),e=expected())=>renderToStaticMarkup(DetachedPreparationView({raw:body,expected:e}));
test('actual view joins historical preparation, context, unverified assertion and exact earlier/current source text without action',t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No request'));const html=render();
 for(const phrase of ['Historical private preparation','Supplied historical review context','Explicitly supplied as empty','Different times, different meanings','Original exact invented passage.',
  'Changed exact invented passage.','What still needs review','not an accepted replacement for the whole issue','Support is proposed only','No editorial action is available','original context spelling'])assert.ok(html.includes(phrase),phrase);
 assert.doesNotMatch(html,/<form|<input|<button|<script|href="(?!#)/);
 assert.match(html,/href="#extraction-candidate"/);assert.match(html,/id="extraction-candidate"/);assert.match(html,/href="#detached-prepared-candidate"/);assert.match(html,/id="detached-prepared-candidate" tabindex="-1"/);
});
test('invalid or altered reports expose no partial private candidate or source text',()=>{
 const r=JSON.parse(raw());r.extraction_report.proposal.proposed_assertion='PRIVATE_CANARY altered candidate';const html=render(canonical(r));
 assert.match(html,/Historical preparation unavailable/);assert.doesNotMatch(html,/PRIVATE_CANARY|Changed exact|Original exact|Supplied historical review context/);
});
test('supplied title markup is escaped after coherent invented byte identity is resealed',()=>{
 const r=JSON.parse(raw()),sha=s=>createHash('sha256').update(s).digest('hex'),payload=JSON.parse(r.parts.payload_json),proof=JSON.parse(r.parts.provenance_json),ctx=JSON.parse(r.parts.context_json);
 const title='<img src=x onerror=alert(1)> Invented review title';payload.snapshot.title=ctx.content.title=title;proof.independent_context=ctx;
 r.parts.payload_json=canonical(payload);r.parts.context_json=canonical(ctx);proof.payload_sha256=sha(r.parts.payload_json);proof.context_sha256=sha(canonical(ctx));proof.supplied_context_sha256=sha(r.parts.context_json);r.parts.provenance_json=canonical(proof);
 const m=JSON.parse(r.intent_json);m.payload_sha256=sha(r.parts.payload_json);m.provenance_sha256=sha(r.parts.provenance_json);m.context_raw_sha256=sha(r.parts.context_json);r.intent_json=canonical(m);
 const body=canonical(r),html=render(body,{reportSha256:sha(body),preparationIntentJson:r.intent_json});assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img|onerror="/);
 assert.match(html,/entirely invented example/i);assert.match(html,/do not authenticate/);
});
test('each timestamp is labelled for its own historical or fresh observation',()=>{
 const html=render();for(const label of ['Private artifact observed for the original preparation','Preparation created','Preparation stored','Complete private artifact reobserved','Preparation read for this report'])assert.ok(html.includes(label));
 assert.match(html,/does not renew source rights/);assert.match(html,/present state is not checked|current public head is not checked/);
});
