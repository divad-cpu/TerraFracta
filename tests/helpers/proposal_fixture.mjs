import {createHash} from 'node:crypto';
import {encodeProposalCapture} from '../../src/server/proposal-capture.ts';
export const proposalId=n=>`87000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const proposalScope=()=>({runId:proposalId(1),decisionId:proposalId(2)});
export const proposalBytes=value=>new TextEncoder().encode(JSON.stringify(value));
const digest=value=>createHash('sha256').update(value).digest('hex');
export function proposedPayload(){return {schemaVersion:1,kind:'review_only',snapshot:{schemaVersion:1,
 jurisdictionSlug:'invented-country',issueSlug:'invented-issue',title:'Invented condition',summary:'Invented proposed summary.',
 lastEvidenceReviewOn:'2026-09-28',claims:[{id:proposalId(3),type:'condition',assertion:'The invented share was 8.2%.',periodLabel:'2026',
 evidence:[{sourceVersionId:proposalId(4),publisher:'Invented publisher',title:'Invented table',url:'https://example.org/invented',
 locator:'invented row 1',relation:'supports',sourcePublishedOn:null,retrievedAt:'2026-09-28T06:00:00.000001Z'},
 {sourceVersionId:proposalId(5),publisher:'Invented second publisher',title:'Invented contrasting table',url:'https://example.org/contrasting',
 locator:'invented row 2',relation:'contradicts',sourcePublishedOn:'2026-09-27',retrievedAt:'2026-09-28T06:00:00.000001Z'}]}]},
 dependencyManifest:{sourceVersionIds:[proposalId(4),proposalId(5)]},conflictCoverage:'recorded_partial',
 translation:{displayLanguage:'en',status:'unreviewed'}};}
export function proposalReport(){
 const payload=proposedPayload(),encoded=encodeProposalCapture(payload);
 const baseSnapshot=structuredClone(payload.snapshot);baseSnapshot.claims[0].assertion='The invented share was 7.5%.';
 const base={id:proposalId(6),issueId:proposalId(7),revision:1,kind:'accepted',snapshot:baseSnapshot,dependencyManifest:payload.dependencyManifest};
 const publicationJson=JSON.stringify(base),publicationSha256=digest(publicationJson);
 return {schemaVersion:1,status:'ok',requested:proposalScope(),observedAt:'2026-09-28T08:00:00.000000Z',
 decision:{decisionId:proposalId(2),decidedAt:'2026-09-28T06:30:00.000001Z',sourceVersionId:proposalId(4),sourceSha256:'a'.repeat(64),
 evidenceLocator:'invented row 1',reasonCodes:['material_conflict'],undisclosedReasonCount:0},
 target:{issueId:proposalId(7),jurisdictionId:'invented-country',jurisdictionSlug:'invented-country',issueSlug:'invented-issue'},
 capture:{captureId:proposalId(8),capturedAt:'2026-09-28T07:00:00.000001Z',...encoded,basePublicationId:proposalId(6),
 baseHeadChangedAt:'2026-09-28T05:00:00.000001Z',baseContentSha256:publicationSha256},
 sourceReceipts:[{sourceVersionId:proposalId(4),contentSha256:'a'.repeat(64),retrievedAt:'2026-09-28T06:00:00.000001Z',languageCode:'nb'},{sourceVersionId:proposalId(5),contentSha256:'b'.repeat(64),retrievedAt:'2026-09-28T06:00:00.000001Z',languageCode:null}],
 base:{publicationJson,publicationSha256}};
}
