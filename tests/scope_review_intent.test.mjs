import assert from "node:assert/strict";
import test from "node:test";
import { scopeDraftHarness } from "./helpers/scope_draft_harness.mjs";
import { capturedScopeDraftContext } from "../src/server/issue-scope-draft.ts";
import { proposalReport, proposalId } from "./helpers/proposal_fixture.mjs";
const field = (h, suffix) => h.nodes().find(n => n.props.id?.endsWith(suffix));
const button = (h, label) => h.nodes().find(n => n.type === "button" && n.props.children === label);
const preview = h => h.nodes().find(n => n.type === "textarea" && n.props.readOnly)?.props.value;
function fill(h) {
 field(h,"-population-wording").props.onChange({currentTarget:{value:"Invented initial population"}});
 field(h,"-population-references").props.onChange({currentTarget:{selectedOptions:[{value:`${proposalId(3)}:1`}]}});
}
test("scope review refuses a rendered draft while newer wording and reference merges remain unrepresented", () => {
 const h=scopeDraftHarness(capturedScopeDraftContext(proposalReport()));h.mount();fill(h);
 h.pauseMerges();
 field(h,"-population-wording").props.onChange({currentTarget:{value:"Invented latest population"}});
 field(h,"-population-references").props.onChange({currentTarget:{selectedOptions:[{value:`${proposalId(3)}:2`}]}});
 const waiting=button(h,"Review scope draft");waiting.props.onClick();
 assert.equal(preview(h),undefined,"Pending field intent must not review the preceding wording or references");
 assert.equal(waiting.props.disabled,true);
 h.flushMerges();button(h,"Review scope draft").props.onClick();
 const saved=JSON.parse(preview(h));assert.equal(saved.fields.population.wording,"Invented latest population");
 assert.equal(saved.fields.population.references[0].referenceNumber,2);h.unmount();
});
test("a first queued scope field edit cannot be reviewed as wholly unknown and Clear still retires its merge",()=>{
 const h=scopeDraftHarness(capturedScopeDraftContext(proposalReport()));h.mount();h.pauseMerges();
 field(h,"-population-wording").props.onChange({currentTarget:{value:"Invented queued new population"}});
 button(h,"Review scope draft").props.onClick();
 assert.equal(preview(h),undefined,"An admitted field edit must not produce a wholly unknown draft before its merge");
 button(h,"Clear scope draft").props.onClick();h.flushMerges();
 assert.equal(field(h,"-population-wording").props.value,"");
 button(h,"Review scope draft").props.onClick();assert.equal(JSON.parse(preview(h)).fields.population,null);h.unmount();
});

test("represented scope review remains available after copied installation and ordinary independent field edits",()=>{
 const h=scopeDraftHarness(capturedScopeDraftContext(proposalReport()));h.mount();fill(h);
 button(h,"Review scope draft").props.onClick();const saved=preview(h);
 field(h,"-reopen-json").props.onChange({currentTarget:{value:saved}});
 button(h,"Reopen scope preparation").props.onClick();assert.equal(button(h,"Review scope draft").props.disabled,false);
 button(h,"Review scope draft").props.onClick();assert.equal(preview(h),saved);
 const old=button(h,"Review scope draft").props.onClick;
 const same=h.nodes();same.find(n=>n.props.id?.endsWith("-population-wording")).props.onChange({currentTarget:{value:"Invented represented replacement"}});
 same.find(n=>n.props.id?.endsWith("-period-wording")).props.onChange({currentTarget:{value:"Invented period"}});
 same.find(n=>n.props.id?.endsWith("-period-references")).props.onChange({currentTarget:{selectedOptions:[{value:`${proposalId(3)}:2`}]}});
 old();assert.equal(preview(h),undefined);assert.equal(button(h,"Review scope draft").props.disabled,false);
 button(h,"Review scope draft").props.onClick();const checked=JSON.parse(preview(h));
 assert.equal(checked.fields.population.wording,"Invented represented replacement");assert.equal(checked.fields.period.wording,"Invented period");
 assert.equal(checked.fields.period.references[0].referenceNumber,2);h.unmount();
});
