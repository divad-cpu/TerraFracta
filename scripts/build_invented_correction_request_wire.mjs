// Fixed invented requests from actual editor callbacks and checked draft values.
// Reader metadata/hooks/UUID entropy are explicitly substituted; no DOM,
// hydration, HTTP, current-health claim, storage or intake endpoint is exercised.
import { publicIssueProjectionSchema } from "../src/public-issue-projection.ts";
import { deriveCorrectionTarget } from "../src/correction-target.ts";
import { checkCorrectionRequest } from "../src/correction-request.ts";
import { editorHarness, elements } from "../tests/helpers/correction_draft_harness.mjs";

if (process.argv.length !== 2) throw new Error("Fixed invented request wire takes no arguments");
let body = Buffer.alloc(0);
for await (const chunk of process.stdin) {
  body = Buffer.concat([body, chunk]);
  if (body.length > 65_536) throw new Error("Invented projection exceeds limit");
}
const issue = publicIssueProjectionSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)));
if (issue.issueId !== "718863b9-75b8-572b-9184-3bc18a13658a" || issue.jurisdictionSlug !== "fictional-country" ||
    issue.issueSlug !== "fictional-share" || issue.claims.length !== 1 || ![1, 2].includes(issue.revision) ||
    issue.publicationId !== ["92bb9213-05e0-550a-8b99-cbf65e786609", "6ac005f4-f9a0-5021-a3b5-28e1f1607397"][issue.revision - 1]) {
  throw new Error("Fixed invented projection required");
}
const fields = { kind: "missing_context", details: "Invented explanation for a private technical correction test.",
  sourceUrl: "https://example.org/fictional-correction-evidence" };
const metadata = { schemaVersion: 1, evidenceKind: "connected_fictional_reader", state: "active", generation: issue.revision,
  executionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", observedAt: new Date().toISOString(),
  actualSourceRequests: 0, modelCalls: 0, livePublicationEnabled: false, issue };
const requests = [issue.claims[0].id, null].map((claimId, index) => {
  const target = deriveCorrectionTarget({ kind: "issue", issue }, claimId);
  if (target.kind !== "available") throw new Error("Invented target held");
  const requestId = `f8a${issue.revision}${index}111-1111-4111-8111-111111111111`;
  const harness = editorHarness(metadata);
  const find = (tree, type, suffix) => elements(tree).find(item => item.type === type && (!suffix || item.props.id?.endsWith(suffix)));
  let tree = harness.render();
  find(tree, "select", "claim").props.onChange({ target: { value: claimId ?? "" } });
  find(tree, "select", "kind").props.onChange({ target: { value: fields.kind } });
  find(tree, "textarea").props.onChange({ target: { value: fields.details } });
  find(tree, "input", "source").props.onChange({ target: { value: fields.sourceUrl } });
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  try {
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: { randomUUID: () => requestId } });
    tree = harness.render(); elements(tree).find(item => item.type === "button" && item.props.children === "Review draft").props.onClick();
    // Repeat the actual callback. The unchanged intent retains one identity.
    tree = harness.render(); elements(tree).find(item => item.type === "button" && item.props.children === "Review draft").props.onClick();
  } finally { Object.defineProperty(globalThis, "crypto", descriptor); }
  const envelope = harness.states().find(value => value?.schemaVersion === 1 && value.requestId && value.draft);
  const prepared = checkCorrectionRequest({ kind: "issue", issue }, envelope);
  if (prepared.kind !== "prepared" || prepared.request.requestId !== requestId ||
      JSON.stringify(prepared.request.draft) !== JSON.stringify({ target: target.target, fields })) throw new Error("Invented editor request held");
  return prepared.request;
});
process.stdout.write(JSON.stringify({ schemaVersion: 1, evidenceKind: "checked_invented_correction_request_wire",
  requests, sourceRequests: 0, realReports: 0, submissionEnabled: false }));
