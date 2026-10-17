import assert from "node:assert/strict";
import test from "node:test";
import { publicIssueProjectionSchema, parsePublicIssueProjection } from "../src/public-issue-projection.ts";
import { materializePublicIssueFromRows } from "../src/public-read-materializer.ts";
import { sixStagePilotRows } from "./helpers/six_stage_pilot_rows.mjs";
import { currentIssueCorrectionContext } from "../src/current-issue-correction-draft.ts";
import { deriveCorrectionTarget } from "../src/correction-target.ts";
import { currentCatalogueResult, currentCatalogueSelection } from "../src/current-visitor-catalog.ts";
import { issueSourceIndex } from "../src/issue-source-index.ts";
import { currentIssueIdentity } from "../src/current-issue-status.ts";

const issue = () => materializePublicIssueFromRows(sixStagePilotRows());
function repeated(alias = false) {
 const value = issue(), copy = structuredClone(value.claims[1]);
 copy.id = alias ? copy.id.toUpperCase() : copy.id;
 copy.assertion = "A different fictional statement cannot share the same UUID target.";
 value.claims.push(copy); return value;
}
test("flat display admission refuses identical and differently cased aliases of a repeated statement UUID", () => {
 for (const alias of [false, true]) assert.equal(publicIssueProjectionSchema.safeParse(repeated(alias)).success, false);
});
test("envelope admission refuses a statement UUID alias alongside existing exact duplicate and manifest guards", () => {
 for(const alias of [false,true]) {
  const rows=sixStagePilotRows(), copy=structuredClone(rows.publication.snapshot.claims[1]);
  if(alias)copy.id=copy.id.toUpperCase();rows.publication.snapshot.claims.push(copy);
  assert.throws(()=>parsePublicIssueProjection({currentPublicationId:rows.publication.id,publication:{id:rows.publication.id,issueId:rows.dossier.id,revision:rows.publication.revision,kind:"accepted",snapshot:rows.publication.snapshot,dependencyManifest:{sourceVersionIds:rows.publication.dependency_manifest.sourceVersionIds}}}));
 }
});
test("current correction context withholds both duplicate spellings before offering any claim or page target",()=>{
 for(const alias of [false,true])assert.equal(currentIssueCorrectionContext(repeated(alias)),null);
});
test("correction target derivation refuses same UUID aliases for page and each ambiguous original occurrence",()=>{
 for(const alias of [false,true]){
  const value=repeated(alias);
  for(const target of [null,value.claims[1].id,value.claims.at(-1).id])assert.deepEqual(deriveCorrectionTarget({kind:"issue",issue:value},target),{kind:"held",reason:"unavailable"});
 }
});
test("directory presentation withholds a duplicate-UUID decision without making a success or source-rights finding",()=>{
 for(const alias of [false,true]){
  const value=repeated(alias),selection=currentCatalogueSelection({view:"issues"});assert.ok(selection);
  assert.deepEqual(currentCatalogueResult({status:200,issue:value},selection),{kind:"unavailable",selection});
 }
});
test("distinct IDs with equal wording remain separate targets while one uppercase UUID preserves its exact spelling and identity projection",()=>{
 const value=issue();value.claims[1].id=value.claims[1].id.toUpperCase();value.claims[2].assertion=value.claims[1].assertion;
 const checked=publicIssueProjectionSchema.parse(value);assert.deepEqual(checked,value);
 assert.ok(currentIssueCorrectionContext(value));
 for(const selected of [1,2]){const target=deriveCorrectionTarget({kind:"issue",issue:value},value.claims[selected].id);assert.equal(target.kind,"available");assert.equal(target.target.claimId,value.claims[selected].id);}
 const references=issueSourceIndex(value).groups.flatMap(group=>group.references);assert.equal(new Set(references.map(item=>item.anchor)).size,references.length);
 assert.ok(currentIssueIdentity(value));
});
