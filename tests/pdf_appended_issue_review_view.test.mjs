import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadTsx} from './helpers/tsx_loader.mjs';
import {canonicalProposalJson as canonical} from '../src/operator-proposal-capture.ts';
const fixture=()=>JSON.parse(readFileSync(new URL('../fixtures/fictional-pdf-appended-issue-review.json',import.meta.url),'utf8'));
const {PdfAppendedIssueReviewView:View}=loadTsx(new URL('../src/pdf-appended-issue-review-view.tsx',import.meta.url));
const sha=s=>createHash('sha256').update(s).digest('hex');
test('complete PDF review preserves every prior claim and reference in order with a distinct addition and historical preparation',t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No source or database request'));
 const f=fixture(),h=renderToStaticMarkup(View(f)),base=JSON.parse(f.bundle.baselineJson),proposal=JSON.parse(f.bundle.proposalJson);
 for(const s of['PDF whole-issue preparation for review','2 preserved statements','1 proposed new statement','0 rewritten','0 removed','Historical statement 1','Historical statement 2','Proposed appended statement 3','No current issue head has been read','Conflict assessment: not recorded','Saved PDF preparation','Detached PDF candidate','not the complete issue proposal','Atomic storage of the complete composition','No editorial action is available'])assert.ok(h.includes(s),s);
 for(const claim of proposal.snapshot.claims)assert.ok(h.includes(claim.assertion),claim.id);
 assert.ok(h.indexOf(base.snapshot.claims[0].assertion)<h.indexOf(base.snapshot.claims[1].assertion));
 for(const id of proposal.dependencyManifest.sourceVersionIds)assert.ok(h.includes(id));
 assert.doesNotMatch(h,/<form|<input|<button|<script|<iframe|href="https?:|%PDF-|base64/);
 const ids=[...h.matchAll(/\bid="([^"]+)"/g)].map(v=>v[1]);assert.equal(new Set(ids).size,ids.length);
 for(const m of h.matchAll(/href="#([^"]+)"/g))assert.ok(ids.includes(m[1]),m[1]);
});
test('supplied complete-page wording remains escaped after fully resealed local correspondence',()=>{
 const f=fixture(),b=f.bundle,e=f.expected,context=JSON.parse(b.contextJson),proof=JSON.parse(b.compositionJson),proposal=JSON.parse(b.proposalJson);
 const title='<img src=x onerror="PRIVATE_MARKUP">';context.page.title=title;proposal.snapshot.title=title;
 b.contextJson=canonical(context);b.proposalJson=canonical(proposal);e.contextSha256=sha(b.contextJson);
 Object.assign(proof,{independent_context:context,context_raw_sha256:e.contextSha256,context_sha256:e.contextSha256,proposal_sha256:sha(b.proposalJson)});
 b.compositionJson=canonical(proof);e.compositionSha256=sha(b.compositionJson);
 const h=renderToStaticMarkup(View(f));assert.match(h,/&lt;img src=x onerror=&quot;PRIVATE_MARKUP&quot;&gt;/);assert.doesNotMatch(h,/<img|<script|<iframe/);
});
test('any invalid complete part or independent preparation identity withholds all candidate baseline and native metadata',()=>{
 for(const field of Object.keys(fixture().bundle)){
  const f=fixture();f.bundle[field]='PRIVATE_CANARY';const h=renderToStaticMarkup(View(f));assert.match(h,/PDF whole-issue preparation unavailable/);assert.doesNotMatch(h,/PRIVATE_CANARY|Historical statement|Saved PDF|Detached PDF|artifact|Invented prior/);
 }
 const f=fixture();f.expected.preparationStoredAt='2026-10-18T09:00:03.000000Z';assert.match(renderToStaticMarkup(View(f)),/PDF whole-issue preparation unavailable/);
});
