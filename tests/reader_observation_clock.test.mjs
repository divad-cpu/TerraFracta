import assert from "node:assert/strict";
import test from "node:test";
import { getEventListeners } from "node:events";
import { createPublicIssueReader } from "../src/server/public-issue-reader.ts";
import { createOperatorAuditReader } from "../src/server/operator-audit-reader.ts";
import { createOperatorAuditChoicesReader } from "../src/server/operator-audit-choices-reader.ts";
import { createHeldDecisionsReader } from "../src/server/operator-held-decisions-reader.ts";
import { createProposalReader } from "../src/server/operator-proposal-reader.ts";
import { sample } from "./helpers/public_read_rows_fixture.mjs";
import { audit,scope } from "./helpers/operator_audit_fixture.mjs";
import { choices } from "./helpers/operator_audit_choices_fixture.mjs";
import { heldReport,heldScope } from "./helpers/operator_held_fixture.mjs";
import { proposalReport,proposalScope } from "./helpers/proposal_fixture.mjs";

const bytes=value => new TextEncoder().encode(JSON.stringify(value));
const variants=[
  {name:"public",factory:createPublicIssueReader,input:() => sample().requestedRoute,body:sample,code:"public_issue_read",held:{status:503,cacheControl:"no-store"}},
  {name:"audit",factory:createOperatorAuditReader,input:scope,body:audit,code:"operator_audit_read",held:{kind:"unavailable"}},
  {name:"choices",factory:createOperatorAuditChoicesReader,input:() => null,body:choices,code:"operator_audit_read",held:{kind:"unavailable"}},
  {name:"held",factory:createHeldDecisionsReader,input:heldScope,body:heldReport,code:"operator_audit_read",held:{kind:"unavailable"}},
  {name:"proposal",factory:createProposalReader,input:proposalScope,body:proposalReport,code:"operator_audit_read",held:{kind:"unavailable"}},
];

for (const v of variants) {
  for (const phase of v.name==="public" ? ["validation"] : ["provider","validation"]) {
    test(`${v.name} backward ${phase} observation withholds checked content and reports one fixed code`,async () => {
      const ticks=v.name==="public" ? [100,120,115] : phase==="provider" ? [100,120,110,130] : [100,110,120,115];
      let n=0,calls=0;const faults=[],controller=new AbortController();
      const read=v.factory(async () => {calls++;return bytes(v.body());},() => ticks[Math.min(n++,ticks.length-1)],
        async (...args) => {faults.push(args);return "saved";});
      assert.deepEqual(await read(v.input(),controller.signal),v.held);
      assert.equal(calls,1);assert.deepEqual(faults,[[v.code]]);
      assert.equal(getEventListeners(controller.signal,"abort").length,0);
    });
  }
  test(`${v.name} equal observations and a separately admitted earlier origin remain healthy`,async () => {
    let tick=-100,calls=0;const faults=[];
    const read=v.factory(async () => {calls++;return bytes(v.body());},() => tick,
      async (...args) => {faults.push(args);return "saved";});
    for (const origin of [-100,-200]) {
      tick=origin;const c=new AbortController();const result=await read(v.input(),c.signal);
      assert.equal(v.name==="public" ? result.status : result.kind,v.name==="public" ? 200 : "ok");
      assert.equal(getEventListeners(c.signal,"abort").length,0);
    }
    assert.equal(calls,2);assert.deepEqual(faults,[]);
  });
}
