// Actual draft contract to a fixed invented SQL test; no submission endpoint.
import { publicIssueProjectionSchema } from "../src/public-issue-projection.ts";
import { deriveCorrectionTarget, checkCorrectionDraft } from "../src/correction-target.ts";

if (process.argv.length !== 2) throw new Error("Fixed invented correction wire takes no arguments");
let body = Buffer.alloc(0);
for await (const chunk of process.stdin) {
  body = Buffer.concat([body, chunk]);
  if (body.length > 65_536) throw new Error("Invented projection exceeds limit");
}
const issue = publicIssueProjectionSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)));
if (issue.jurisdictionSlug !== "fictional-country" || issue.issueSlug !== "fictional-share" ||
    issue.issueId !== "718863b9-75b8-572b-9184-3bc18a13658a" || issue.claims.length !== 1 ||
    ![1, 2].includes(issue.revision) || issue.publicationId !==
      ["92bb9213-05e0-550a-8b99-cbf65e786609", "6ac005f4-f9a0-5021-a3b5-28e1f1607397"][issue.revision - 1]) throw new Error("Fixed invented projection required");
const fields = { kind: "missing_context", details: "Invented explanation for a private technical correction test.",
  sourceUrl: "https://example.org/fictional-correction-evidence" };
const requests = [issue.claims[0].id, null].map(claimId => {
  const target = deriveCorrectionTarget({ kind: "issue", issue }, claimId);
  if (target.kind !== "available") throw new Error("Invented target held");
  const checked = checkCorrectionDraft({ kind: "issue", issue }, { target: target.target, fields });
  if (checked.kind !== "preview") throw new Error("Invented draft held");
  return { target: checked.draft.target, fields: checked.draft.fields };
});
process.stdout.write(JSON.stringify({ schemaVersion: 1, evidenceKind: "checked_invented_correction_wire",
  requests, sourceRequests: 0, realReports: 0, submissionEnabled: false }));
