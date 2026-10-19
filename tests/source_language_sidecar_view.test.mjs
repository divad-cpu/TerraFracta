import assert from 'node:assert/strict';
import test from 'node:test';
import {renderToStaticMarkup}from'react-dom/server';
import {loadTsx}from'./helpers/tsx_loader.mjs';
import {inventedSourceLanguageCandidate}from'../app/evidence-preview/source-language/example.ts';
import {materializeSourceLanguageSidecarFromRows,sourceLanguageSidecarSha256,sourceLanguageSnapshotSha256}from'../src/server/source-language-sidecar.ts';
const{SourceLanguageSidecarView:View}=loadTsx(new URL('../src/source-language-sidecar-view.tsx',import.meta.url));
const{IssueEvidence}=loadTsx(new URL('../app/issue-evidence.tsx',import.meta.url));
const qualified=()=>{const x=inventedSourceLanguageCandidate();return materializeSourceLanguageSidecarFromRows(x.rows,x.sidecar,x.languageReviews,x.finalReview);};
const render=(candidate,prefix='language-test')=>renderToStaticMarkup(View({candidate,prefix}));
test('separate candidate shows supplied wording and unknown source language without English-title inference or IO',t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No source request'));
 const value=qualified(),html=render(value);
 for(const message of ['Norwegian Bokmål and English — fictional wording','Unknown — no reviewed original-language wording supplied','does not add language fields','does not refresh the underlying evidence','translation quality or factual support','not real language-competent review'])assert.ok(html.includes(message),message);
 assert.match(html,/2026-09-25T14:00:00.000000002Z/);assert.equal(value.issue.lastEvidenceReviewOn,'2026-09-25');
 assert.equal((html.match(/<dt>Source-described original language<\/dt>/g)??[]).length,2);
 assert.doesNotMatch(html,/<form|<input|<button|<textarea|href="https?:|download=/);
});
test('every reused exact source occurrence links to the unchanged base dossier without counting independent sources',()=>{
 const value=qualified(),html=render(value),parent=renderToStaticMarkup(IssueEvidence({issue:value.issue}));
 const ids=[...parent.matchAll(/\sid="([^"]+)"/g)].map(x=>x[1]);
 for(const[,target]of html.matchAll(/href="#([^"]+)"/g))assert.equal(ids.filter(id=>id===target).length,1,target);
 assert.match(html,/Points to a conflict/);assert.match(html,/Several listed versions may share an original source/);
 assert.equal((html.match(/href="#reference-/g)??[]).length,3);
});
test('invalid candidate binding digest coverage and prefix withhold all language wording',()=>{
 const value=qualified(),cases=[];
 const changed=fn=>{const next=structuredClone(value);fn(next);cases.push(next);};
 changed(x=>x.sidecar.publicationId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 changed(x=>x.sidecar.revision++);changed(x=>x.sidecar.sources[0].originalLanguage='CHANGED_PRIVATE');
 changed(x=>{x.sidecar.sources.pop();x.sidecarSha256=sourceLanguageSidecarSha256(x.sidecar);});
 changed(x=>{x.sidecar.sources[0].sourceVersionId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';x.sidecarSha256=sourceLanguageSidecarSha256(x.sidecar);});
 for(const input of [null,...cases]){const html=render(input);assert.match(html,/candidate unavailable/);assert.doesNotMatch(html,/Norwegian|CHANGED_PRIVATE|href=|id=/);}
 for(const prefix of ['','a'.repeat(129),'<script>PRIVATE']){const html=render(value,prefix);assert.match(html,/candidate unavailable/);assert.doesNotMatch(html,/PRIVATE|Norwegian/);}
});
test('raw snapshot binding is not reconstructed from deliberately withheld source dates',()=>{
 const x=inventedSourceLanguageCandidate(),value=qualified();
 assert.equal(x.rows.publication.snapshot.claims[0].evidence[0].sourcePublishedOn,'2026-09-20');assert.equal(value.issue.claims[0].evidence[0].sourcePublishedOn,null);
 const{issueId,publicationId,revision,...snapshot}=value.issue;
 assert.notEqual(sourceLanguageSnapshotSha256({schemaVersion:1,...snapshot}),value.sidecar.baseSnapshotSha256);
 assert.match(render(value),/Norwegian Bokmål and English/);
 const base=renderToStaticMarkup(IssueEvidence({issue:value.issue}));assert.match(base,/No verified source publication date supplied/);
});
test('source-described language wording stays escaped and separate panel namespaces remain unique',()=>{
 const value=qualified();value.sidecar.sources[0].originalLanguage='<img src=x onerror="PRIVATE">';value.sidecarSha256=sourceLanguageSidecarSha256(value.sidecar);
 const html=render(value,'first')+render(value,'second');assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img|<script/);
 const ids=[...html.matchAll(/\sid="([^"]+)"/g)].map(x=>x[1]);assert.equal(ids.length,new Set(ids).size);
});
