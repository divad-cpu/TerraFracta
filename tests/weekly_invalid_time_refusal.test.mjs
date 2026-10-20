import assert from 'node:assert/strict';
import test from 'node:test';
import {z} from 'zod';
import {weeklyRehearsalObservationSchema,parseWeeklyRehearsalStatus} from '../src/weekly-rehearsal-status.ts';
const good=()=>({schemaVersion:1,evidenceKind:'current_local_fictional_weekly_status',observedAt:'2026-10-05T07:30:00.123456Z',dueAt:'2026-10-05T06:00:00Z',windowKey:'2026-W41',graceMinutes:60,state:'attention',reason:'scheduled_run_missing',coverage:'unknown',totalReceipts:0,unreadableReceipts:0,pendingReceipts:0,realScheduleEnabled:false,trustedRunLedger:false,sourceRequests:0,publicationEnabled:false,alertsSent:0});
const malformed=['NOT_A_DATE','2026-13-05T07:30:00Z','2026-10-05T25:00:00Z','2026-10-05T07:30:00','0000-10-05T07:30:00Z','2026-10-05T07:30:00.1234567Z','2026-10-05T07:30:00+02:00','2026-02-30T07:30:00Z'];
for(const field of ['observedAt','dueAt'])test(`invalid weekly ${field} stays an ordinary schema refusal before calendar arithmetic`,()=>{
 for(const value of malformed){let result;assert.doesNotThrow(()=>{result=weeklyRehearsalObservationSchema.safeParse({...good(),[field]:value});},`${field}: ${value}`);assert.equal(result.success,false,value);assert.ok(result.error instanceof z.ZodError);assert.ok(result.error.issues.some(issue=>issue.path[0]===field),value);}
});
test('weekly status parser reports invalid timestamps as Zod validation instead of a native date exception',()=>{
 for(const field of ['observedAt','dueAt'])assert.throws(()=>parseWeeklyRehearsalStatus({state:'observed',observation:{...good(),[field]:'NOT_A_DATE'}}),z.ZodError);
});
test('whole and microsecond UTC spelling keep exact valid observation bytes and no operational authority',()=>{
 for(const suffix of ['Z','+00:00']){const input=good();input.observedAt='2026-10-05T07:30:00.123456'+suffix;input.dueAt='2026-10-05T06:00:00.000000'+suffix;const before=JSON.stringify(input);const result=weeklyRehearsalObservationSchema.safeParse(input);assert.equal(result.success,true);assert.equal(JSON.stringify(result.data),before);assert.equal(JSON.stringify(input),before);assert.equal(result.data.realScheduleEnabled,false);assert.equal(result.data.publicationEnabled,false);}
});
test('valid leaf dates still enforce weekly-window, receipt and state relationships',()=>{
 for(const change of [{windowKey:'2026-W42'},{dueAt:'2026-10-06T06:00:00Z'},{observedAt:'2026-10-05T05:59:59.999999Z'},{state:'healthy'},{pendingReceipts:1},{unreadableReceipts:1}])assert.equal(weeklyRehearsalObservationSchema.safeParse({...good(),...change}).success,false);
});
