import { recordedHoldReasonExplanation, recordedHoldExplanationNotice } from "./recorded-hold-reasons.ts";
import { capturedProposalHref, proposalBrowseSelection } from "./operator-proposal-navigation.ts";
import { heldBrowseHref } from "./operator-held-browse.ts";
import { OperatorWorkspaceNavigation } from "./operator-workspace-navigation-view.tsx";
import { PageIntro } from "../app/components";
import { proposalScopeSchema, recordedProposalBaseSchema, type ProposalScope, type ProposalCapturePayload } from "./operator-proposal-capture.ts";
import { decodeProposalCapture, parseCapturedProposalEnvelope } from "./server/proposal-capture.ts";
import type { ProposalReadDecision } from "./server/operator-proposal-reader.ts";
import { compareRecordedProposalSnapshots, type RecordedProposalChanges } from "./recorded-proposal-changes.ts";

import { compareRecordedReferenceOccurrences, recordedProposalReferenceAnchor } from "./recorded-reference-differences.ts";

const labels = {
  invalid_scope: ["Choose a recorded decision", "This selection is invalid. No proposal was inspected."],
  unconfigured: ["Proposal connection unavailable", "The private connection is not configured. No proposal has been read."],
  unavailable: ["Proposal unavailable", "The records could not be checked. Details are withheld; this is not an empty or healthy result."],
  not_found: ["Held decision not found", "This decision was not found as a held decision in the selected run."],
  capture_missing: ["Proposal not captured", "The held decision has no separately saved proposal. Its source hash cannot reconstruct the proposed wording, target page, conflicts or translation."],
  changed: ["Comparison changed", "The captured base or evidence metadata changed. Stale proposal details are withheld. A new capture and reevaluation are needed."],
} as const;
function pageFieldAnchor(side: "base" | "proposed", field: RecordedProposalChanges["snapshotFields"][number]) {
  return `proposal-${side}-page-${field}`;
}
function statementFieldAnchor(side: "base" | "proposed", claimId: string,
  field: RecordedProposalChanges["statements"][number]["fields"][number]) {
  return `proposal-${side}-claim-${claimId}-field-${field}`;
}
function Snapshot({ snapshot, name, side }: { snapshot: ProposalCapturePayload["snapshot"]; name: string; side: "base" | "proposed" }) {
  return <section aria-label={name} id={`proposal-${side}-snapshot`}><h2>{name}</h2><h3 id={pageFieldAnchor(side, "title")}>{snapshot.title}</h3><p id={pageFieldAnchor(side, "summary")}>{snapshot.summary}</p>
    <p id={pageFieldAnchor(side, "lastEvidenceReviewOn")}>Recorded last evidence review: <time dateTime={snapshot.lastEvidenceReviewOn}>{snapshot.lastEvidenceReviewOn}</time></p>
    <ol className="current-source-list">{snapshot.claims.map(claim => <li key={claim.id} id={`proposal-${side}-claim-${claim.id}`}>
      <h4 id={statementFieldAnchor(side, claim.id, "type")}>{claim.type.replaceAll("_", " ")}</h4><p id={statementFieldAnchor(side, claim.id, "assertion")}>{claim.assertion}</p><p id={statementFieldAnchor(side, claim.id, "periodLabel")}>Data period: {claim.periodLabel}</p>
      <ul id={statementFieldAnchor(side, claim.id, "evidence")}>{claim.evidence.map((e, i) => <li key={i} id={recordedProposalReferenceAnchor(side, claim.id, i)}><strong>{e.relation === "contradicts" ? "Conflicting evidence" : e.relation === "supports" ? "Supporting evidence" : "Context"}</strong>
        <p>{e.title} · {e.publisher}</p><p>Location: {e.locator}</p><p>Source address: <code>{e.url}</code></p>
        <p>Source version: <code>{e.sourceVersionId}</code>; source published: {e.sourcePublishedOn ?? "Not recorded"}; retrieved: <time dateTime={e.retrievedAt}>{e.retrievedAt}</time>.</p>
      </li>)}</ul>
    </li>)}</ol></section>;
}
const changeLabels = {
  title: "Title", summary: "Summary", lastEvidenceReviewOn: "Recorded evidence review date",
  type: "Statement type", assertion: "Wording", periodLabel: "Data period", evidence: "Source references",
} as const;
function ReferenceDifferences({ before, after }: {
  before: ProposalCapturePayload["snapshot"]["claims"][number]; after: ProposalCapturePayload["snapshot"]["claims"][number];
}) {
  const differences = compareRecordedReferenceOccurrences(before.evidence, after.evidence);
  return <section aria-label="Reference records that differ"><h3>Reference records that differ</h3>
    <p>Matching uses every recorded field and counts repeated occurrences. A metadata change appears on each side. This comparison does not qualify a source or its evidence.</p>
    <p>{differences.identical} identical reference {differences.identical === 1 ? "occurrence" : "occurrences"}; {differences.baseOnly.length} only in the recorded panel; {differences.proposedOnly.length} only in the proposed panel.</p>
    {differences.orderOnly && <p>The same recorded reference values appear in a different order. No reference value was added or removed.</p>}
    {(differences.baseOnly.length > 0 || differences.proposedOnly.length > 0) && <ul aria-label="Reference values present on one side">
      {differences.baseOnly.map(({ source, index }) => <li key={`base:${index}`}>
        <a href={`#${recordedProposalReferenceAnchor("base", before.id, index)}`}>Recorded reference {index + 1}</a> · {source.title} · {source.locator} · {source.relation === "contradicts" ? "Conflicting evidence" : source.relation === "supports" ? "Supporting evidence" : "Context"}
      </li>)}
      {differences.proposedOnly.map(({ source, index }) => <li key={`proposed:${index}`}>
        <a href={`#${recordedProposalReferenceAnchor("proposed", after.id, index)}`}>Proposed reference {index + 1}</a> · {source.title} · {source.locator} · {source.relation === "contradicts" ? "Conflicting evidence" : source.relation === "supports" ? "Supporting evidence" : "Context"}
      </li>)}
    </ul>}
  </section>;
}
function RecordedChanges({ changes }: { changes: RecordedProposalChanges }) {
  return <section className="info-band" aria-labelledby="proposal-changes-heading"><h2 id="proposal-changes-heading">Recorded changes</h2>
    <p>This overview compares the captured proposal with its recorded base. Counts describe recorded differences; they do not measure importance, correctness or publication eligibility.</p>
    {changes.baseAbsent ? <p>The witnessed issue head had no publication. All proposed statements are additions against that checked absence.</p> : <>
      <p>{changes.snapshotFields.length ? `Changed page fields: ${changes.snapshotFields.map(field => changeLabels[field]).join(", ")}.` : "No page fields changed."} <a href="#proposal-base-snapshot">Recorded page</a> · <a href="#proposal-proposed-snapshot">Proposed page</a></p>
      {changes.snapshotFields.length > 0 && <ul aria-label="Changed page fields">{changes.snapshotFields.map(field => <li key={field}>
        {changeLabels[field]}: <a href={`#${pageFieldAnchor("base", field)}`}>Recorded {changeLabels[field].toLowerCase()}</a> · <a href={`#${pageFieldAnchor("proposed", field)}`}>Proposed {changeLabels[field].toLowerCase()}</a>
      </li>)}</ul>}
      {changes.statementOrderChanged && <p>The same statement IDs appear in a different order. Both panels preserve their recorded order.</p>}
    </>}
    <p>Statements: {changes.counts.added} added; {changes.counts.removed} removed; {changes.counts.changed} changed; {changes.counts.unchanged} unchanged.</p>
    {changes.statements.length > 0 ? <ul>{changes.statements.map(statement => <li key={statement.id}>
      <p>{statement.kind === "added" ? "Added statement" : statement.kind === "removed" ? "Removed statement" : `Changed statement: ${statement.fields.map(field => changeLabels[field]).join(", ")}`}.</p>
      {statement.before && <a href={`#proposal-base-claim-${statement.id}`}>Recorded statement {statement.beforeIndex! + 1}</a>}
      {statement.before && statement.after && " · "}
      {statement.after && <a href={`#proposal-proposed-claim-${statement.id}`}>Proposed statement {statement.afterIndex! + 1}</a>}
      {statement.before && statement.after && statement.fields.length > 0 && <ul aria-label="Changed statement fields">{statement.fields.map(field => <li key={field}>
        {changeLabels[field]}: <a href={`#${statementFieldAnchor("base", statement.id, field)}`}>Recorded {changeLabels[field].toLowerCase()}</a> · <a href={`#${statementFieldAnchor("proposed", statement.id, field)}`}>Proposed {changeLabels[field].toLowerCase()}</a>
      </li>)}</ul>}
      {statement.before && statement.after && statement.fields.includes("evidence") && <ReferenceDifferences before={statement.before} after={statement.after} />}
    </li>)}</ul> : <p>No statement fields changed.</p>}
  </section>;
}
export function ProposalComparisonView({ decision, selection, browseQuery }: { decision: ProposalReadDecision; selection?: ProposalScope; browseQuery?: unknown }) {
  let report = null, payload = null, base = null;
  let changes: RecordedProposalChanges | null = null;
  let held: keyof typeof labels = "unavailable";
  let selected: ProposalScope | null = null;
  try {
    // Capture one checked selection for both comparison and recovery navigation.
    // A caller's fields may change or throw if observed again.
    if (decision.kind !== "invalid_scope" && selection !== undefined) {
      const checked = proposalScopeSchema.safeParse(selection);
      if (checked.success) selected = checked.data;
    }
    if (decision.kind === "ok") {
      const parsed = parseCapturedProposalEnvelope(decision.report);
      if (parsed.status === "ok" && (selection === undefined || selected !== null &&
        selected.runId === parsed.requested.runId && selected.decisionId === parsed.requested.decisionId)) {
        report = parsed; payload = decodeProposalCapture(parsed.capture.proposalJson, parsed.capture.proposalSha256);
        base = parsed.base === null ? null : recordedProposalBaseSchema.parse(JSON.parse(parsed.base.publicationJson));
        changes = compareRecordedProposalSnapshots(base?.snapshot ?? null, payload.snapshot);
      }
    } else if (Object.hasOwn(labels, decision.kind)) held = decision.kind;
  } catch { report = null; payload = null; base = null; changes = null; }
  if (report !== null) selected = report.requested;
  const browse = selected ? proposalBrowseSelection(browseQuery) : null;
  const heldReturn = browse && selected && browse.scope.runId === selected.runId && browse.scope.decisionId === selected.decisionId ? browse.held : null;
  return <div className="content-page"><PageIntro eyebrow="Development only / Private recorded proposal" title="Proposal comparison">
    <p>Inspect a separately captured proposal and its recorded base. This page has no approval, editing, collection or publication control.</p>
  </PageIntro><OperatorWorkspaceNavigation active="comparison" context={report ? { runId: report.requested.runId, decisionId: report.requested.decisionId, issueId: report.target.issueId } : selected ? { runId: selected.runId, decisionId: selected.decisionId } : {}} />{report === null || payload === null ? <section className="info-band" role="status"><h2>{labels[held][0]}</h2><p>{labels[held][1]}</p></section> : <>
    <section className="info-band" role="note"><h2>Unverified proposal</h2><p>The proposed wording is private review material. Parsing, storing or displaying it does not approve a source, resolve a conflict or qualify it for publication.</p></section>
    <p>Affected page: <code>/countries/{report.target.jurisdictionSlug}/issues/{report.target.issueSlug}</code>. This is a recorded target, not a link to a verified public page.</p>
    <dl><div><dt>Decision reference</dt><dd><code>{report.decision.decisionId}</code></dd></div>
      <div><dt>Capture reference</dt><dd><code>{report.capture.captureId}</code></dd></div>
      <div><dt>Captured (UTC)</dt><dd><time dateTime={report.capture.capturedAt}>{report.capture.capturedAt}</time></dd></div>
      <div><dt>Records observed (UTC)</dt><dd><time dateTime={report.observedAt}>{report.observedAt}</time></dd></div></dl>
    <h2>Recorded hold reasons</h2><p role="note">{recordedHoldExplanationNotice}</p><ul>{report.decision.reasonCodes.map((r, i) => <li key={i}>{r.replaceAll("_", " ")}<details><summary>Meaning of {r.replaceAll("_", " ")}</summary><p>{recordedHoldReasonExplanation(r)}</p></details></li>)}</ul>
    {report.decision.undisclosedReasonCount > 0 && <p>{report.decision.undisclosedReasonCount} other reason entries are withheld.</p>}
    <section className="info-band"><h2>Evidence and translation coverage</h2>
      <p>{payload.conflictCoverage === "not_recorded" ? "Conflict-search coverage was not recorded." : "Some conflict evidence was captured; completeness was not established."} Missing conflicting evidence is not evidence of agreement.</p>
      <p>Display language: {payload.translation.displayLanguage}. Translation: {payload.translation.status === "not_required" ? "Recorded source languages match the display language; no translation is indicated." : payload.translation.status === "unreviewed" ? "Unreviewed. No accepted translation receipt is recorded." : "Not recorded. Translation quality is unknown."}</p>
      <ul>{report.sourceReceipts.map(e => <li key={e.sourceVersionId}>Source <code>{e.sourceVersionId}</code>: {e.languageCode ?? "Language not recorded"}. Captured content <code>{e.contentSha256}</code>; retrieved <time dateTime={e.retrievedAt}>{e.retrievedAt}</time>.</li>)}</ul>
    </section>
    {changes && <RecordedChanges changes={changes} />}
    <div className="proposal-comparison">{base === null ? <section id="proposal-base-snapshot"><h2>Recorded current publication</h2><p>The witnessed issue head had no publication. This is a checked absence, not a failed read.</p></section> : <>
      <Snapshot snapshot={base.snapshot} name="Recorded current publication" side="base" />
    </>}<Snapshot snapshot={payload.snapshot} name="Proposed content — unverified" side="proposed" /></div>
    <p>The captured base still matches this read. Current public eligibility and source health were not checked. A later change requires a fresh read.</p>
  </>}<nav className="current-issue-nav" aria-label="Editorial workspace">
    {report === null && selected && <a href={capturedProposalHref(selected, heldReturn)}>Read this selected comparison again</a>}
    {selected && <a href={heldBrowseHref(heldReturn?.scope ?? { runId: selected.runId, cursor: null }, heldReturn?.reason ?? "", heldReturn?.runReturn ?? null)}>{heldReturn ? "Return to the selected held page (new read)" : report ? "Back to this run’s held decisions" : "Back to the selected run’s held decisions"}</a>}
    {heldReturn && <p>The return selection is navigation only. The held page will be checked again; its decisions or reasons may have changed.</p>}
    <a href="/editorial-preview/audit/select">Choose another recorded run</a><a href="/editorial-preview">Back to the review desk</a>
  </nav></div>;
}
