import assert from 'node:assert/strict';
import test from 'node:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadTsx} from './helpers/tsx_loader.mjs';
import {proposalReport,proposalScope} from './helpers/proposal_fixture.mjs';
const {ProposalComparisonView:View}=loadTsx(new URL('../src/operator-proposal-view.tsx',import.meta.url));
const render=report=>renderToStaticMarkup(View({decision:{kind:'ok',report},selection:proposalScope()}));

test('joined actual parent retains complete receipt text and original translation status with exact locator targets',()=>{
 const report=proposalReport(),html=render(report),ids=[...html.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]);
 assert.equal(ids.length,new Set(ids).size);
 assert.match(html,/Find captured source receipts by recorded language code/);
 assert.match(html,/Translation: Unreviewed. No accepted translation receipt is recorded/);
 for(let i=1;i<=2;i++)assert.equal(ids.filter(id=>id===`proposal-source-receipt-${i}`).length,1);
 for(const[,href]of html.matchAll(/href="#(proposal-source-(?:receipt|version)-\d+)"/g))assert.equal(ids.filter(id=>id===href).length,1,href);
 for(const r of report.sourceReceipts){assert.match(html,new RegExp(r.contentSha256));assert.ok(html.includes(r.retrievedAt));}
 assert.match(html,/These are historical receipt codes, not detected or verified original languages/);
});
test('missing language code remains unknown and known-language comparison does not change review wording',()=>{
 const report=proposalReport();report.sourceReceipts[0].languageCode='en';const html=render(report);
 assert.match(html,/Recorded code: en/);assert.match(html,/Language code not recorded/);
 assert.match(html,/No accepted translation receipt is recorded/);assert.doesNotMatch(html,/translation approved|language verified|requires translation/);
});
test('failed parent admission and forged translation bypass expose no locator or receipts',()=>{
 const report=proposalReport(),payload=JSON.parse(report.capture.proposalJson);payload.translation.status='not_required';
 report.capture.proposalJson=JSON.stringify(payload); // Deliberately stale exact digest: parent rejects before any child.
 const html=render(report);assert.doesNotMatch(html,/Find captured source receipts|proposal-source-receipt-1|Recorded code: nb/);
});
