import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {renderToStaticMarkup} from 'react-dom/server';import {loadTsx} from './helpers/tsx_loader.mjs';import {canonicalProposalJson as canonical} from '../src/operator-proposal-capture.ts';
const vectors=()=>JSON.parse(readFileSync(new URL('../fixtures/fictional-appended-issue-review.json',import.meta.url),'utf8')).cases;
const {AppendedIssueReviewView:View}=loadTsx(new URL('../src/appended-issue-review-view.tsx',import.meta.url));
const render=({bundle,expected})=>renderToStaticMarkup(View({bundle,expected}));const sha=s=>createHash('sha256').update(s).digest('hex');
test('whole issue shows all preserved statements explicit wholepage wording and exact appended candidate without actions',t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No request'));const html=render(vectors()[0]);
 for(const phrase of ['Whole-issue preparation for review','2 preserved statements; 1 proposed new statement; 0 rewritten; 0 removed','Invented existing observation one.',
 'Invented existing observation two.','Explicit whole-issue review title','Proposed appended statement 3','Original exact invented passage.','Changed exact invented passage.',
 'not saved as an actual held proposal','Atomic linkage','not authenticated provenance','No editorial action is available','not recorded','translation status: unreviewed'])assert.ok(html.includes(phrase),phrase);
 assert.doesNotMatch(html,/<form|<button|<input|<script|href="(?!#)/);assert.match(html,/href="#extraction-candidate"/);assert.match(html,/id="extraction-candidate"/);
 assert.match(html,/id="appended-proposed-statement" tabindex="-1"/);assert.match(html,/href="#appended-proposed-statement"/);
});
test('any admission failure withholds both historical and proposed private content',()=>{
 const b=vectors()[0];b.bundle.contextJson='PRIVATE_CANARY';const html=render(b);assert.match(html,/Whole-issue preparation unavailable/);
 assert.doesNotMatch(html,/PRIVATE_CANARY|Invented existing observation|Changed exact|Complete proposal dependency manifest|Proposed appended/);
});
test('coherently supplied wholepage markup remains text and no source address becomes an external link',()=>{
 const b=vectors()[0],ctx=JSON.parse(b.bundle.contextJson),payload=JSON.parse(b.bundle.proposalJson),proof=JSON.parse(b.bundle.compositionJson);
 ctx.page.title=payload.snapshot.title='<img src=x onerror=alert(1)> Invented title';b.bundle.contextJson=canonical(ctx);b.bundle.proposalJson=canonical(payload);
 proof.independent_context=ctx;proof.context_sha256=sha(canonical(ctx));proof.context_raw_sha256=sha(b.bundle.contextJson);proof.proposal_sha256=sha(b.bundle.proposalJson);
 b.bundle.compositionJson=canonical(proof);b.expected.contextSha256=sha(b.bundle.contextJson);b.expected.compositionSha256=sha(b.bundle.compositionJson);
 const html=render(b);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img|href="https?:|onerror="/);assert.match(html,/whole-page wording/);
});
test('all thirty composed statements remain inspectable with source occurrences and historical qualification limits',()=>{
 const html=render(vectors()[3]);assert.match(html,/Inspect all 29 preserved historical statements/);assert.match(html,/Proposed appended statement 30/);
 assert.equal((html.match(/Historical statement \d+ ·/g)||[]).length,29);assert.match(html,/Repeated uses of a source are not independent confirmation/);
 assert.match(html,/Opening this example performs no fresh storage read/);assert.match(html,/supplied review date does not prove/);
 assert.match(html,/original single-candidate preparation without replacing its intent/);
});
