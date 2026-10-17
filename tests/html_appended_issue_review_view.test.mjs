import assert from 'node:assert/strict';import test from 'node:test';import {renderToStaticMarkup} from 'react-dom/server';import {loadTsx} from './helpers/tsx_loader.mjs';import {htmlAppendedIssueReviewVectors} from './helpers/html_appended_issue_review_vectors.mjs';
const{HtmlAppendedIssueReviewView:View}=loadTsx(new URL('../src/html-appended-issue-review-view.tsx',import.meta.url)),fixture=htmlAppendedIssueReviewVectors();
test('whole HTML issue exposes preserved prefix explicit page wording source passages and separate remaining gates',()=>{
 const h=renderToStaticMarkup(View(fixture));for(const p of['HTML whole-issue preparation for review','2 preserved statements','1 proposed new statement','0 rewritten','0 removed','Historical statement 1','Historical statement 2','Proposed appended statement 3','Explicit whole-issue review title','The six-value capture command is prepared but never executed','narrower accepted-publication gate','parsed values and byte fingerprint'])assert.ok(h.includes(p),p);
 assert.ok(h.indexOf('Invented prior observation one.')<h.indexOf('Invented prior observation two.'));assert.equal((h.match(/id="html-preparation-heading"/g)||[]).length,1);assert.equal((h.match(/id="html-extraction-review-heading"/g)||[]).length,1);
 const ids=[...h.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length);for(const m of h.matchAll(/href="#([^"]+)"/g))assert.ok(ids.includes(m[1]),m[1]);assert.doesNotMatch(h,/<form|<button|<input/);
});
test('independent complete-page markup is escaped and full source text is passive',()=>{
 const h=renderToStaticMarkup(View(fixture.cases[3]));assert.match(h,/&lt;script&gt;alert\(&quot;quoted&quot;\)&lt;\/script&gt;/);assert.match(h,/&lt;img src=x onerror=quoted&gt;/);assert.doesNotMatch(h,/<script|<img|<iframe/);
});
test('bad complete composition withholds every baseline candidate and source fragment',()=>{
 const b=structuredClone(fixture.bundle);b.compositionJson='PRIVATE_CANARY';const h=renderToStaticMarkup(View({bundle:b,expected:fixture.expected}));assert.match(h,/HTML whole-issue preparation unavailable/);assert.doesNotMatch(h,/PRIVATE_CANARY|Invented prior|Historical HTML preparation|condition remains/);
});
