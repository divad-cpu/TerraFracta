import { recordedSourceLanguageLocations } from "./recorded-source-language-locations.ts";
import { RecordedSourceLanguageFinder } from "./recorded-source-language-finder-view.tsx";
import { IssueScopeDraftView } from "./issue-scope-draft-view.tsx";
import { ResponsibilityDraftView } from "./responsibility-draft-view.tsx";
import { PolicyEventDraftView } from "./policy-event-draft-view.tsx";
import { FundingDraftView } from "./funding-draft-view.tsx";
import { IndicatorDraftView } from "./indicator-draft-view.tsx";
import { DeliveryDraftView } from "./delivery-draft-view.tsx";
import { PlannedMilestoneDraftView } from "./planned-milestone-draft-view.tsx";
import { CompletePreparationOrganizerView } from "./complete-preparation-organizer-view.tsx";
import { EvaluationDraftView } from "./evaluation-draft-view.tsx";
import { EvaluationPreparationBundleView } from "./evaluation-preparation-bundle-view.tsx";
import { PreparationPacketView } from "./preparation-packet-view.tsx";
import { capturedScopeDraftContext } from "./server/issue-scope-draft.ts";
import { statementLabels } from "./issue-display-labels.ts";
import { recordedHoldReasonExplanation, recordedHoldExplanationNotice } from "./recorded-hold-reasons.ts";
import { capturedProposalHref, proposalBrowseSelection } from "./operator-proposal-navigation.ts";
import { heldBrowseHref, recordedHoldAnchor } from "./operator-held-browse.ts";
import { OperatorWorkspaceNavigation } from "./operator-workspace-navigation-view.tsx";
import { PageIntro } from "../app/components";
import { proposalScopeSchema, recordedProposalBaseSchema, type ProposalScope, type ProposalCapturePayload } from "./operator-proposal-capture.ts";
import { decodeProposalCapture, parseCapturedProposalEnvelope } from "./server/proposal-capture.ts";
import type { ProposalReadDecision } from "./server/operator-proposal-reader.ts";
import { compareRecordedProposalSnapshots, type RecordedProposalChanges } from "./recorded-proposal-changes.ts";

import { compareRecordedReferenceOccurrences, recordedProposalReferenceAnchor } from "./recorded-reference-differences.ts";
import { recordedProposalSourceIndex } from "./recorded-proposal-source-index.ts";
import { recordedReferenceEntries } from "./recorded-reference-finder.ts";
import { RecordedReferenceFinder } from "./recorded-reference-finder-view.tsx";
import type { CapturedProposalReport } from "./operator-proposal-capture.ts";

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
type SourceIndex = ReturnType<typeof recordedProposalSourceIndex>;
function Snapshot({ snapshot, name, side, sourceIndex }: { snapshot: ProposalCapturePayload["snapshot"]; name: string; side: "base" | "proposed"; sourceIndex: SourceIndex }) {
  const sourceGroups = new Map(sourceIndex.groups.map(group => [group.sourceVersionId.toLowerCase(), group]));
  return <section aria-label={name} id={`proposal-${side}-snapshot`} tabIndex={-1}><h2>{name}</h2><h3 id={pageFieldAnchor(side, "title")}>{snapshot.title}</h3><p id={pageFieldAnchor(side, "summary")}>{snapshot.summary}</p>
    <p id={pageFieldAnchor(side, "lastEvidenceReviewOn")}>Recorded last evidence review: <time dateTime={snapshot.lastEvidenceReviewOn}>{snapshot.lastEvidenceReviewOn}</time></p>
    <p>Statement numbers follow the record order of each panel; they do not establish chronology or importance. Reference numbers belong to their statement in this panel.</p>
    <ol className="current-source-list">{snapshot.claims.map((claim, statementIndex) => <li key={claim.id} id={`proposal-${side}-claim-${claim.id}`}>
      <h4 id={statementFieldAnchor(side, claim.id, "type")}>{side === "base" ? "Recorded" : "Proposed"} statement {statementIndex + 1} · {statementLabels[claim.type]}</h4><p id={statementFieldAnchor(side, claim.id, "assertion")}>{claim.assertion}</p><p id={statementFieldAnchor(side, claim.id, "periodLabel")}>Data period: {claim.periodLabel}</p>
      <ul id={statementFieldAnchor(side, claim.id, "evidence")}>{claim.evidence.map((e, i) => <li key={i} id={recordedProposalReferenceAnchor(side, claim.id, i)}><strong>Reference {i + 1} · {e.relation === "contradicts" ? "Conflicting evidence" : e.relation === "supports" ? "Supporting evidence" : "Context"}</strong>
        <p>{e.title} · {e.publisher}</p><p>Location: {e.locator}</p><p>Source address: <code>{e.url}</code></p>
        <p>Source version: <code>{e.sourceVersionId}</code>; source published: {e.sourcePublishedOn ?? "Not recorded"}; retrieved: <time dateTime={e.retrievedAt}>{e.retrievedAt}</time>.</p>
        <p><a href={`#${sourceGroups.get(e.sourceVersionId.toLowerCase())!.anchor}`}>Inspect all recorded uses of this source version</a></p>
      </li>)}</ul>
    </li>)}</ol></section>;
}
function SourceVersions({ index, receipts }: { index: SourceIndex; receipts: CapturedProposalReport["sourceReceipts"] }) {
  const receiptPositions = new Map(receipts.map((receipt, position) => [receipt.sourceVersionId.toLowerCase(), position]));
  return <details className="proposal-source-index"><summary>Source versions across this comparison</summary>
    <p>{index.referenceCount} reference {index.referenceCount === 1 ? "occurrence" : "occurrences"} across {index.groups.length} recorded source {index.groups.length === 1 ? "version" : "versions"}.</p>
    <p>Grouping uses exact recorded version references, not titles, publishers or addresses. Repeated uses are not independent confirmation; different versions do not establish independent origins.</p>
    <p>Every occurrence keeps its panel, statement, position and metadata. A proposal receipt does not verify the recorded panel's reference values or current source eligibility.</p>
    <ol>{index.groups.map(group => <li key={group.sourceVersionId}>
      <h3 id={group.anchor}>Recorded source version {group.number}</h3><p><code>{group.sourceVersionId}</code></p>
      <p>Recorded panel: {group.base.references} reference {group.base.references === 1 ? "occurrence" : "occurrences"} across {group.base.statements} {group.base.statements === 1 ? "statement" : "statements"}.</p>
      <p>Proposed panel: {group.proposed.references} reference {group.proposed.references === 1 ? "occurrence" : "occurrences"} across {group.proposed.statements} {group.proposed.statements === 1 ? "statement" : "statements"}.</p>
      {receiptPositions.has(group.sourceVersionId.toLowerCase()) ? <p><a href={`#proposal-source-receipt-${receiptPositions.get(group.sourceVersionId.toLowerCase())! + 1}`}>Inspect the proposal source receipt</a>. Its language and retrieval record belong to this captured proposal.</p> :
        <p>No proposal source receipt for this version. Its language and current source state were not checked.</p>}
      <ul>{group.occurrences.map(occurrence => <li key={occurrence.anchor}>
        <a href={`#${occurrence.anchor}`}>{occurrence.side === "base" ? "Recorded" : "Proposed"} statement {occurrence.statementIndex + 1}, reference {occurrence.referenceIndex + 1}</a>: {occurrence.source.title} · {occurrence.source.locator} · {occurrence.source.relation === "contradicts" ? "Conflicting evidence" : occurrence.source.relation === "supports" ? "Supporting evidence" : "Context"}
      </li>)}</ul>
    </li>)}</ol>
  </details>;
}
function StatementTypes({ base, proposed }: { base: ProposalCapturePayload["snapshot"] | null; proposed: ProposalCapturePayload["snapshot"] }) {
  return <section id="proposal-statement-types" tabIndex={-1} aria-labelledby="proposal-statement-types-heading">
    <h2 id="proposal-statement-types-heading">Statement types across this comparison</h2>
    <p>These are recorded categories, not a chronology, progress score or evidence of cause. Each link keeps its panel's original statement number and data period.</p>
    <p>Missing types describe these captured panels, not the absence of action or evidence elsewhere. Proposed statements remain unverified review material.</p>
    {base === null && <p>The witnessed issue head had no publication. There is no recorded panel to count; this is a checked absence, not a failed read.</p>}
    <dl>{Object.entries(statementLabels).map(([type, label]) => <div key={type} data-statement-type={type}>
      <dt><strong>{label}</strong></dt><dd>{([{ side: "base", name: "Recorded", snapshot: base }, { side: "proposed", name: "Proposed", snapshot: proposed }] as const).map(({ side, name, snapshot }) => {
        if (snapshot === null) return null;
        const entries = snapshot.claims.map((claim, index) => ({ claim, index })).filter(({ claim }) => claim.type === type);
        return <div key={side}><p>{name} panel: {entries.length} {entries.length === 1 ? "statement" : "statements"}.</p>
          {entries.length ? <ul>{entries.map(({ claim, index }) => <li key={claim.id}><a href={`#proposal-${side}-claim-${claim.id}`}>{name} statement {index + 1}: {claim.periodLabel}</a></li>)}</ul> : <p>No statement of this type in the {side === "base" ? "recorded" : "proposed"} panel.</p>}
        </div>;
      })}</dd>
    </div>)}</dl>
  </section>;
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
  return <section className="info-band" aria-labelledby="proposal-changes-heading"><h2 id="proposal-changes-heading" tabIndex={-1}>Recorded changes</h2>
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
      {statement.before && <a href={`#proposal-base-claim-${statement.before.id}`}>Recorded statement {statement.beforeIndex! + 1}</a>}
      {statement.before && statement.after && " · "}
      {statement.after && <a href={`#proposal-proposed-claim-${statement.after.id}`}>Proposed statement {statement.afterIndex! + 1}</a>}
      {statement.before && statement.after && statement.fields.length > 0 && <ul aria-label="Changed statement fields">{statement.fields.map(field => <li key={field}>
        {changeLabels[field]}: <a href={`#${statementFieldAnchor("base", statement.before!.id, field)}`}>Recorded {changeLabels[field].toLowerCase()}</a> · <a href={`#${statementFieldAnchor("proposed", statement.after!.id, field)}`}>Proposed {changeLabels[field].toLowerCase()}</a>
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
  const sourceIndex = report && payload ? recordedProposalSourceIndex(base?.snapshot ?? null, payload.snapshot) : null;
  const sourceGroups = new Map(sourceIndex?.groups.map(group => [group.sourceVersionId.toLowerCase(), group]) ?? []);
  const scopeContext = report ? capturedScopeDraftContext(report) : null;
  const languageLocations = report && sourceIndex ? recordedSourceLanguageLocations(report.sourceReceipts, sourceIndex) : null;
  const browse = selected ? proposalBrowseSelection(browseQuery) : null;
  const heldReturn = browse && selected && browse.scope.runId === selected.runId && browse.scope.decisionId === selected.decisionId ? browse.held : null;
  return <div className="content-page"><PageIntro eyebrow="Development only / Private recorded proposal" title="Proposal comparison">
    <p>Inspect a separately captured proposal and its recorded base. Captured content cannot be edited here. Local scope, responsibility, policy-event, funding, indicator, delivery, evaluation and planned-milestone preparations are unsent; there is no approval, collection or publication control.</p>
  </PageIntro><OperatorWorkspaceNavigation active="comparison" context={report ? { runId: report.requested.runId, decisionId: report.requested.decisionId, issueId: report.target.issueId } : selected ? { runId: selected.runId, decisionId: selected.decisionId } : {}} />{report === null || payload === null ? <section className="info-band" role="status"><h2>{labels[held][0]}</h2><p>{labels[held][1]}</p></section> : <>
    <section className="info-band" role="note"><h2>Unverified proposal</h2><p>The proposed wording is private review material. Parsing, storing or displaying it does not approve a source, resolve a conflict or qualify it for publication.</p></section>
    <nav className="current-issue-nav" id="proposal-comparison-sections" tabIndex={-1} aria-label="Sections of this captured comparison">
      <a href="#proposal-hold-reasons">Recorded hold reasons</a>
      <a href="#proposal-coverage">Evidence and translation coverage</a>
      {sourceIndex && scopeContext && <a href="#proposal-reference-finder">Find a reference</a>}
      {sourceIndex && <a href="#proposal-source-versions">Source-version index (expand)</a>}
      <a href="#proposal-statement-types">Statement types</a>
      {scopeContext && <a href="#proposal-scope-preparation">Unsent scope preparation (expand)</a>}
      {scopeContext && <a href="#proposal-responsibility-preparation">Unsent responsibility preparation (expand)</a>}
      {scopeContext && <a href="#proposal-policy-event-preparation">Unsent policy-event preparation (expand)</a>}
      {scopeContext && <a href="#proposal-funding-preparation">Unsent funding preparation (expand)</a>}
      {scopeContext && <a href="#proposal-indicator-preparation">Unsent indicator preparation (expand)</a>}
      {scopeContext && <a href="#proposal-delivery-preparation">Unsent delivery preparation (expand)</a>}
      {scopeContext && <a href="#proposal-planned-milestone-preparation">Unsent planned-milestone preparation (expand)</a>}
      {scopeContext && <a href="#proposal-evaluation-preparation">Unsent evaluation preparation (expand)</a>}
      {scopeContext && <a href="#proposal-preparation-packet">Keep unsent preparations together (expand)</a>}
      {scopeContext && <a href="#proposal-evaluation-bundle">Keep evaluation and other preparations together (expand)</a>}
      {scopeContext && <a href="#proposal-complete-preparation">Read preparations with planned milestones (expand)</a>}
      {changes && <a href="#proposal-changes-heading">Recorded changes</a>}
      <a href="#proposal-base-snapshot">Recorded publication panel</a>
      <a href="#proposal-proposed-snapshot">Proposed content panel</a>
    </nav>
    <p>Affected page: <code>/countries/{report.target.jurisdictionSlug}/issues/{report.target.issueSlug}</code>. This is a recorded target, not a link to a verified public page.</p>
    <dl><div><dt>Decision reference</dt><dd><code>{report.decision.decisionId}</code></dd></div>
      <div><dt>Capture reference</dt><dd><code>{report.capture.captureId}</code></dd></div>
      <div><dt>Captured (UTC)</dt><dd><time dateTime={report.capture.capturedAt}>{report.capture.capturedAt}</time></dd></div>
      <div><dt>Records observed (UTC)</dt><dd><time dateTime={report.observedAt}>{report.observedAt}</time></dd></div></dl>
    <h2 id="proposal-hold-reasons" tabIndex={-1}>Recorded hold reasons</h2><p role="note">{recordedHoldExplanationNotice}</p><ul>{report.decision.reasonCodes.map((r, i) => <li key={i}>{r.replaceAll("_", " ")}<details><summary>Meaning of {r.replaceAll("_", " ")}</summary><p>{recordedHoldReasonExplanation(r)}</p></details></li>)}</ul>
    {report.decision.undisclosedReasonCount > 0 && <p>{report.decision.undisclosedReasonCount} other reason entries are withheld.</p>}
    <section className="info-band" id="proposal-coverage" tabIndex={-1}><h2>Evidence and translation coverage</h2>
      <p>{payload.conflictCoverage === "not_recorded" ? "Conflict-search coverage was not recorded." : "Some conflict evidence was captured; completeness was not established."} Missing conflicting evidence is not evidence of agreement.</p>
      <p>Display language: {payload.translation.displayLanguage}. Translation: {payload.translation.status === "not_required" ? "Recorded source languages match the display language; no translation is indicated." : payload.translation.status === "unreviewed" ? "Unreviewed. No accepted translation receipt is recorded." : "Not recorded. Translation quality is unknown."}</p>
      {languageLocations && scopeContext && <RecordedSourceLanguageFinder key={scopeContext.binding.comparisonSha256} locations={languageLocations} comparisonKey={scopeContext.binding.comparisonSha256} />}
      <ul>{report.sourceReceipts.map((e, index) => <li key={e.sourceVersionId} id={`proposal-source-receipt-${index + 1}`}>Source <code>{e.sourceVersionId}</code>: {e.languageCode ?? "Language not recorded"}. Captured content <code>{e.contentSha256}</code>; retrieved <time dateTime={e.retrievedAt}>{e.retrievedAt}</time>. <a href={`#${sourceGroups.get(e.sourceVersionId.toLowerCase())!.anchor}`}>Inspect recorded uses in the comparison</a></li>)}</ul>
    </section>
    {sourceIndex && scopeContext && <div id="proposal-reference-finder" tabIndex={-1}><RecordedReferenceFinder key={scopeContext.binding.comparisonSha256} entries={recordedReferenceEntries(sourceIndex)} /></div>}
    {sourceIndex && <div id="proposal-source-versions" tabIndex={-1}><SourceVersions index={sourceIndex} receipts={report.sourceReceipts} /></div>}
    <StatementTypes base={base?.snapshot ?? null} proposed={payload.snapshot} />
    {scopeContext && <div id="proposal-scope-preparation" tabIndex={-1}><IssueScopeDraftView key={scopeContext.binding.comparisonSha256} context={scopeContext} /></div>}
    {scopeContext && <div id="proposal-responsibility-preparation" tabIndex={-1}><ResponsibilityDraftView key={scopeContext.binding.comparisonSha256} context={scopeContext} /></div>}
    {scopeContext && <div id="proposal-policy-event-preparation" tabIndex={-1}><PolicyEventDraftView key={scopeContext.binding.comparisonSha256} context={scopeContext} /></div>}
    {scopeContext && <div id="proposal-funding-preparation" tabIndex={-1}><FundingDraftView key={scopeContext.binding.comparisonSha256} context={scopeContext} /></div>}
    {scopeContext && <div id="proposal-indicator-preparation" tabIndex={-1}><IndicatorDraftView key={scopeContext.binding.comparisonSha256} context={scopeContext} /></div>}
    {scopeContext && <div id="proposal-delivery-preparation" tabIndex={-1}><DeliveryDraftView key={scopeContext.binding.comparisonSha256} context={scopeContext} /></div>}
    {scopeContext && <div id="proposal-planned-milestone-preparation" tabIndex={-1}><PlannedMilestoneDraftView key={scopeContext.binding.comparisonSha256} context={scopeContext} /></div>}
    {scopeContext && <div id="proposal-evaluation-preparation" tabIndex={-1}><EvaluationDraftView key={scopeContext.binding.comparisonSha256} context={scopeContext} /></div>}
    {scopeContext && <div id="proposal-preparation-packet" tabIndex={-1}><PreparationPacketView key={scopeContext.binding.comparisonSha256} context={scopeContext} /></div>}
    {scopeContext && <div id="proposal-evaluation-bundle" tabIndex={-1}><EvaluationPreparationBundleView key={scopeContext.binding.comparisonSha256} context={scopeContext} /></div>}
    {scopeContext && <div id="proposal-complete-preparation" tabIndex={-1}><CompletePreparationOrganizerView key={scopeContext.binding.comparisonSha256} context={scopeContext} /></div>}
    {changes && <RecordedChanges changes={changes} />}
    <div className="proposal-comparison">{base === null ? <section id="proposal-base-snapshot" tabIndex={-1}><h2>Recorded current publication</h2><p>The witnessed issue head had no publication. This is a checked absence, not a failed read.</p></section> : <>
      <Snapshot snapshot={base.snapshot} name="Recorded current publication" side="base" sourceIndex={sourceIndex!} />
    </>}<Snapshot snapshot={payload.snapshot} name="Proposed content — unverified" side="proposed" sourceIndex={sourceIndex!} /></div>
    <p>The captured base still matches this read. Current public eligibility and source health were not checked. A later change requires a fresh read.</p>
    <p><a href="#proposal-comparison-sections">Back to comparison sections</a></p>
  </>}<nav className="current-issue-nav" aria-label="Editorial workspace">
    {report === null && selected && <a href={capturedProposalHref(selected, heldReturn)}>Read this selected comparison again</a>}
    {selected && <a href={heldBrowseHref(heldReturn?.scope ?? { runId: selected.runId, cursor: null }, heldReturn?.reason ?? "", heldReturn?.runReturn ?? null, heldReturn?.referenceQuery ?? "")}>{heldReturn ? "Return to the selected held page (new read)" : report ? "Back to this run’s held decisions" : "Back to the selected run’s held decisions"}</a>}
    {report && heldReturn && <p><a href={`${heldBrowseHref(heldReturn.scope, heldReturn.reason, heldReturn.runReturn ?? null, heldReturn.referenceQuery ?? "")}#${recordedHoldAnchor(report.decision.decisionId)}`}>Locate this recorded hold on the selected page (new read)</a>. The selected decision may be absent or filtered out after that read; this link does not retain the held page.</p>}
    {heldReturn && <p>The return selection is navigation only. The held page will be checked again; its decisions or reasons may have changed.</p>}
    <a href="/editorial-preview/audit/select">Choose another recorded run</a><a href="/editorial-preview">Back to the review desk</a>
  </nav></div>;
}
