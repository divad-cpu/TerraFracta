import { z } from "zod";
import { publicIssueProjectionSchema } from "./public-issue-projection.ts";
import { plannedMilestoneCandidateSchema, plannedMilestoneCandidateJson, milestoneDatePosition } from "./planned-milestone-candidate.ts";
import { plannedMilestoneCandidateSha256 } from "./server/planned-milestone-candidate.ts";
import { plannedMilestoneComparisonDate } from "./planned-milestone-comparison.ts";
import { preparedEventDateLabel } from "./policy-event-draft.ts";
import { issueSourceIndex, issueReferenceAnchor } from "./issue-source-index.ts";
import { statementLabels, evidenceLabels } from "./issue-display-labels.ts";
const schema = z.strictObject({ issue: publicIssueProjectionSchema, candidate: plannedMilestoneCandidateSchema,
  candidateSha256: z.string().regex(/^[0-9a-f]{64}$/), finalReviewedAt: z.iso.datetime({ offset: true }) });
const labels = { description: "Source-described planned milestone", targetDate: "Source-described target date or period",
  institution: "Source-described institution", reportedDate: "When the source reported this plan" } as const;
const positions = {
  before: "The target period is before the comparison date. Completion and delay are not established.",
  overlaps: "The target period includes the comparison date. No completion or delay is inferred.",
  after: "The target period is after the comparison date. This does not establish that the plan is still active.",
  not_comparable: "No calendar comparison is made for an unknown date or a source-stated period.",
};
function checked(input: unknown) {
  try {
    const value = schema.parse(input), { issue, candidate } = value;
    if (plannedMilestoneCandidateJson(candidate) === null || plannedMilestoneCandidateSha256(candidate) !== value.candidateSha256 ||
        candidate.publicationId !== issue.publicationId || candidate.revision !== issue.revision) return null;
    const index = issueSourceIndex(issue), sources = new Set(candidate.sources.map(source => source.sourceVersionId));
    if (sources.size !== candidate.sources.length || sources.size !== index.groups.length || index.groups.some(group => !sources.has(group.sourceVersionId))) return null;
    const claims = new Map(issue.claims.map((claim, n) => [claim.id, { claim, number: n + 1 }]));
    for (const entry of candidate.entries) {
      const claim = claims.get(entry.claimId)?.claim;
      if (!claim || !["policy_action", "delivery"].includes(claim.type)) return null;
      for (const field of Object.values(entry.fields)) if (field !== null)
        for (const ref of field.references) if (!claims.get(ref.claimId)?.claim.evidence[ref.referenceNumber - 1]) return null;
    }
    return { value, claims, numbers: new Map(index.groups.flatMap(group => group.references.map(ref => [ref.anchor, ref.referenceNumber]))) };
  } catch { return null; }
}
// Supplementary server-rendered candidate only. Raw snapshot/content/review
// qualification is upstream; never reconstruct a raw snapshot from display data.
export function PlannedMilestoneCandidateView({ candidate: input, comparisonDate, prefix }: { candidate: unknown; comparisonDate: string; prefix: string }) {
  const reading = checked(input);
  if (!reading || plannedMilestoneComparisonDate({ comparisonOn: comparisonDate }) === null ||
      typeof prefix !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(prefix))
    return <p>Planned-milestone candidate unavailable. No partial plan is shown.</p>;
  const { candidate, finalReviewedAt } = reading.value;
  return <section className="info-band" aria-label="Separate planned-milestone candidate">
    <h2>Documented planned milestones — separate candidate</h2>
    <p>These are source-described plans, not completed events. A passed target does not establish delay, failure, completion or that work never started. A later target does not establish that a plan remains active. The order shown is not chronology or importance.</p>
    <p>Explicit comparison date: <time dateTime={comparisonDate}>{comparisonDate}</time>. Only calendar position is compared. A year or month stays a year or month; no exact day is invented. This is not a system-clock check or verification of current source health.</p>
    <p>Candidate metadata review: <time dateTime={finalReviewedAt}>{finalReviewedAt}</time>. This is separate from source publication, retrieval and the underlying publication's evidence review. The existing v1 publication still carries no planned-milestone fields.</p>
    {candidate.entries.length === 0 ? <p>No milestone entries supplied in this candidate. This does not establish that no plans or targets exist.</p> : <ol>{candidate.entries.map((entry, index) => {
      const owner = reading.claims.get(entry.claimId)!;
      return <li key={index} id={`${prefix}-entry-${index + 1}`} tabIndex={-1}>
        <h3>Plan entry {index + 1}</h3><p><a href={`#claim-${entry.claimId}`}>Statement {owner.number} · {statementLabels[owner.claim.type]} · <bdi>{owner.claim.periodLabel}</bdi></a></p>
        <dl>{(Object.keys(labels) as Array<keyof typeof labels>).map(name => {
          const field = entry.fields[name];
          return <div key={name}><dt>{labels[name]}</dt><dd>{field === null ? <p>Unknown — no reviewed field supplied.</p> : <>
            <p><bdi>{"wording" in field ? field.wording : preparedEventDateLabel(field.date)}</bdi></p>
            {name === "targetDate" && "date" in field && <p>{positions[milestoneDatePosition(field.date, comparisonDate)]}</p>}
            <ul>{field.references.map(ref => {
              const source = reading.claims.get(ref.claimId)!.claim.evidence[ref.referenceNumber - 1], anchor = issueReferenceAnchor(ref.claimId, ref.referenceNumber - 1);
              return <li key={`${ref.claimId}:${ref.referenceNumber}`}><a href={`#${anchor}`}>Reference {reading.numbers.get(anchor)}: <bdi>{source.title}</bdi> · <bdi>{source.locator}</bdi></a>
                <p>Role for this planned field: {evidenceLabels[ref.relation]}. Original role for its statement: {evidenceLabels[source.relation]}.</p></li>;
            })}</ul>
          </>}{name === "targetDate" && field === null && <p>{positions.not_comparable}</p>}</dd></div>;
        })}</dl>
      </li>;
    })}</ol>}
    <p>Institutions and dates are not inferred from a current government, publisher or retrieval time. References retain their exact occurrences; reuse is not independent confirmation. Invented accepted-looking review rows are not factual, language-competent, rights, authenticated or publication approval.</p>
  </section>;
}
