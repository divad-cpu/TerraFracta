import assert from 'node:assert/strict';import test from 'node:test';import {existsSync} from 'node:fs';
import {heldReasonCodes} from '../src/operator-held-decisions.ts';
const source=new URL('../src/recorded-hold-reasons.ts',import.meta.url),api=existsSync(source)?await import(source.href):null;
function explain(code){assert.ok(api,'Explicit original feature absence: recorded code explanation helper is absent');return api.recordedHoldReasonExplanation(code);}
test('each closed recorded code has a distinct nonempty explanation without changing the existing code set',()=>{
 const values=heldReasonCodes.map(code=>explain(code));assert.equal(values.length,31);assert.equal(new Set(values).size,31);
 for(const value of values){assert.equal(typeof value,'string');assert.ok(value.length>40);assert.ok(!/[<>]/.test(value));}
});
test('missing passing checks and a passed-code hold do not become facts, source independence or publication receipts',()=>{
 for(const code of ['source_version_not_current','identity_unresolved','fields_dates_units_unverified','material_conflict','snapshot_inconsistent','predecessor_changed','sensitive_data_present'])assert.match(explain(code),/not (established|identify|specify)/);
 assert.match(explain('material_conflict'),/does not identify a contradiction/);assert.match(explain('sensitive_data_present'),/does not establish that sensitive data was found/);
 assert.match(explain('qualified_checks_passed'),/not a publication receipt or a current approval/);assert.match(explain('qualified_checks_passed'),/held record remains held/);
 assert.match(explain('shadow_mode'),/not a publication receipt/);assert.match(explain('qualification_expired_or_invalid'),/does not distinguish these causes/);
 assert.match(explain('source_endpoint_mismatch'),/shared publisher or domain does not establish equivalence/);
 for(const text of ['not current findings','failed or unrecorded check','undisclosed reasons','remains held'])assert.ok(api.recordedHoldExplanationNotice.includes(text));
});
test('unknown, prototype, private or non-string codes yield no fabricated definition or coercion',()=>{
 for(const value of [undefined,null,[],{},'PRIVATE_CANARY','toString','constructor','__proto__',' material_conflict',Symbol('private'),{toString(){assert.fail('coerced private input');}}])assert.equal(explain(value),null);
});
