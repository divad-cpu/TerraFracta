import assert from 'node:assert/strict';
import test from 'node:test';
import {requireRecentCopyScopeStatus as copyRecent} from '../src/current-copy-scope.ts';
import {requireRecentPreparationStatus as preparationRecent} from '../src/current-private-preparation.ts';
import {requireRecentWeeklyRehearsalStatus as weeklyRecent} from '../src/weekly-rehearsal-status.ts';
import {createCurrentCopyScopeObserver} from '../src/server/current-copy-scope.ts';
import {createCurrentPreparationObserver} from '../src/server/current-private-preparation.ts';
import {createWeeklyRehearsalObserver} from '../src/server/weekly-rehearsal-status.ts';

const base='2026-10-05T07:30:00',clock=Date.parse(base+'Z');
const copy=stamp=>({state:'observed',observation:{schemaVersion:1,evidenceKind:'current_local_copy_scope_observation',recordedAt:stamp,pointInTimeOnly:true,state:'held',backupExclusion:'observed',syncSetup:'present',otherCopies:'owner_context_pending',allCopyPathsVerified:false,credentialFilesRead:false,rawBodiesRead:false,configurationChanged:false,sourceRequests:0,collectionPermissionIssued:false,publicationEnabled:false}});
const preparation=stamp=>({state:'observed',observation:{schemaVersion:1,evidenceKind:'current_local_preparation_observation',recordedAt:stamp,state:'held',liveStatus:false,pointInTimeOnly:true,sourceReview:'private_attempt_supported',retentionDays:30,checks:['cleanupSnapshot','cleanupUnitBytes','cleanupManager','cleanupHistory','selectedRawFolder'].map(key=>({key,state:'held'})),copyScope:'owner_context_pending',liveEntry:'not_bound',privateWriter:'not_selected',sourceRequests:0,collectionPermissionIssued:false,publicationEnabled:false}});
const weekly=stamp=>({state:'observed',observation:{schemaVersion:1,evidenceKind:'current_local_fictional_weekly_status',observedAt:stamp,dueAt:'2026-10-05T06:00:00Z',windowKey:'2026-W41',graceMinutes:60,state:'attention',reason:'scheduled_run_missing',coverage:'unknown',totalReceipts:0,unreadableReceipts:0,pendingReceipts:0,realScheduleEnabled:false,trustedRunLedger:false,sourceRequests:0,publicationEnabled:false,alertsSent:0}});
for(const [name,recent,make,observer,path,reason] of [
 ['copy',copyRecent,copy,createCurrentCopyScopeObserver,'copy-scope','copy_observation_unavailable'],
 ['preparation',preparationRecent,preparation,createCurrentPreparationObserver,'source-readiness','local_observation_unavailable'],
 ['weekly',weeklyRecent,weekly,createWeeklyRehearsalObserver,'update-rehearsal/status','weekly_rehearsal_unavailable'],
]){
 test(name+' refuses every admitted future microsecond without rounded milliseconds',()=>{
  for(const fraction of ['000001','000031','000250','000999']) for(const suffix of ['Z','+00:00'])
   assert.throws(()=>recent(make(base+'.'+fraction+suffix),clock),/time unavailable/);
  assert.throws(()=>recent(make(base+'.000251Z'),clock+0.25));
 });
 test(name+' preserves exact fractional inclusive freshness endpoints and input bytes',()=>{
  const value=make(base+'.000250+00:00'),before=structuredClone(value);
  assert.deepEqual(recent(value,clock+0.25),value);
  assert.deepEqual(recent(value,clock+30000.25),value);
  assert.throws(()=>recent(value,clock+30000.375));
  assert.deepEqual(value,before);
  for(const suffix of ['Z','+00:00']) for(const fraction of ['', '.0','.000000'])
   assert.deepEqual(recent(make(base+fraction+suffix),clock),make(base+fraction+suffix));
 });
 test(name+' keeps held results clock independent and refuses observed nonfinite or distant clocks',()=>{
  const held={state:'held',reason};
  for(const now of [NaN,Infinity,-Infinity,-0,0,Number.MIN_VALUE,-Number.MIN_VALUE,Number.MAX_VALUE,-Number.MAX_VALUE]){
   assert.deepEqual(recent(held,now),held);
   assert.throws(()=>recent(make(base+'.000000Z'),now));
  }
  for(const stamp of [base+'.0000001Z','0000-10-05T07:30:00Z',base+'+02:00'])
   assert.throws(()=>recent(make(stamp),clock));
 });
 test(name+' observer withholds future precision and private fields using only mocked inspection',async()=>{
  let reads=0;const future=make(base+'.000001Z');
  const handle=observer(async()=>{reads++;return future;},()=>clock);
  const request=()=>new Request('http://127.0.0.1:3000/api/dev/'+path,{headers:{'sec-fetch-site':'same-origin'}});
  const response=await handle(request(),'development');
  assert.deepEqual(await response.json(),{state:'held',reason});
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(reads,1);
  const valid=observer(async()=>make(base+'.000250Z'),()=>clock+0.25);
  assert.deepEqual(await (await valid(request(),'development')).json(),make(base+'.000250Z'));
  const malformed=observer(async()=>({...future,privatePath:'private-canary'}),()=>clock);
  const body=await (await malformed(request(),'development')).text();
  assert.deepEqual(JSON.parse(body),{state:'held',reason});assert.ok(!body.includes('canary'));
 });
}
