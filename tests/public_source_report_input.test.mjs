import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {updateRunReportSchema} from '../src/update-run-report.ts';
const saved=JSON.parse(readFileSync(new URL('../fixtures/fictional_update_report.json',import.meta.url),'utf8'));
for(const value of ['https://example.org:65536/table','not a URL','https://[']) {
 test(`fictional report contains invalid source URL ${value}`,()=>{
  const report=structuredClone(saved);report.items[0].source.url=value;
  let result;assert.doesNotThrow(()=>{result=updateRunReportSchema.safeParse(report);});
  assert.equal(result.success,false);
 });
}
test('fictional report source hostname still restricts real domains',()=>{
 assert.equal(updateRunReportSchema.safeParse(saved).success,true);
 const report=structuredClone(saved);report.items[0].source.url='https://data.example.org/table';
 assert.equal(updateRunReportSchema.safeParse(report).success,false);
});
