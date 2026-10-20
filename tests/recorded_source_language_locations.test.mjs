import assert from 'node:assert/strict';
import test from 'node:test';
import {recordedSourceLanguageLocations,matchingSourceLanguageLocations} from '../src/recorded-source-language-locations.ts';
import {recordedProposalSourceIndex} from '../src/recorded-proposal-source-index.ts';
import {parseCapturedProposalEnvelope,decodeProposalCapture} from '../src/server/proposal-capture.ts';
import {proposalReport} from './helpers/proposal_fixture.mjs';
function sample(){const report=parseCapturedProposalEnvelope(proposalReport()),payload=decodeProposalCapture(report.capture.proposalJson,report.capture.proposalSha256),base=JSON.parse(report.base.publicationJson);return{report,index:recordedProposalSourceIndex(base.snapshot,payload.snapshot)};}

test('captured language locations preserve exact receipt numbering and source-use backlinks without changing input',()=>{
 const {report,index}=sample(),before=structuredClone(report.sourceReceipts),locations=recordedSourceLanguageLocations(report.sourceReceipts,index);
 assert.equal(locations.entries.length,2);assert.ok(index.referenceCount>2);
 assert.deepEqual(locations.entries.map(e=>[e.receiptNumber,e.languageCode,e.receiptHref,e.usesHref]),[[1,'nb','#proposal-source-receipt-1','#proposal-source-version-1'],[2,null,'#proposal-source-receipt-2','#proposal-source-version-2']]);
 assert.deepEqual(report.sourceReceipts,before);assert.deepEqual(locations.codes,['nb']);
});
test('All exact code and missing-code choices retain original order and distinct historical states',()=>{
 const {report,index}=sample(),locations=recordedSourceLanguageLocations(report.sourceReceipts,index);
 assert.deepEqual(matchingSourceLanguageLocations(locations,'all').map(x=>x.receiptNumber),[1,2]);
 assert.deepEqual(matchingSourceLanguageLocations(locations,'code:nb').map(x=>x.receiptNumber),[1]);
 assert.deepEqual(matchingSourceLanguageLocations(locations,'missing').map(x=>x.receiptNumber),[2]);
 for(const value of ['',null,{},true,'code:en','code:NB','__proto__','missing '])assert.equal(matchingSourceLanguageLocations(locations,value),null);
});
test('recorded code case is retained exactly and same-code versions remain separate receipts',()=>{
 const {report,index}=sample();report.sourceReceipts[0].languageCode='nb-NO';report.sourceReceipts[1].languageCode='nb-no';
 let locations=recordedSourceLanguageLocations(report.sourceReceipts,index);
 assert.deepEqual(locations.codes,['nb-NO','nb-no']);assert.deepEqual(matchingSourceLanguageLocations(locations,'code:nb-NO').map(x=>x.receiptNumber),[1]);
 report.sourceReceipts[1].languageCode='nb-NO';locations=recordedSourceLanguageLocations(report.sourceReceipts,index);
 assert.deepEqual(locations.codes,['nb-NO']);assert.equal(matchingSourceLanguageLocations(locations,'code:nb-NO').length,2);
 assert.deepEqual(matchingSourceLanguageLocations(locations,'missing'),[]);
});
test('missing joined source group or original receipt bound violation withholds locations without fallback',()=>{
 const {report,index}=sample();assert.equal(recordedSourceLanguageLocations(report.sourceReceipts,{...index,groups:[]}),null);
 assert.equal(recordedSourceLanguageLocations([],index),null);
 assert.equal(recordedSourceLanguageLocations(Array(121).fill(report.sourceReceipts[0]),index),null);
});
