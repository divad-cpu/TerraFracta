import type { Metadata } from "next";
import { notFound, unstable_rethrow } from "next/navigation";
import { awaitRouteSelectors } from "../../../src/await-route-selectors.ts";
import { plannedMilestoneComparisonDate } from "../../../src/planned-milestone-comparison.ts";
import { materializeDocumentedPlansCandidateFromRows } from "../../../src/server/documented-plans-candidate.ts";
import { SourceLanguageSidecarView } from "../../../src/source-language-sidecar-view.tsx";
import { PlannedMilestoneCandidateView } from "../../../src/planned-milestone-candidate-view.tsx";
import { IssueEvidence } from "../../issue-evidence.tsx";
import { PageIntro } from "../../components.tsx";
import { inventedPlannedMilestoneCandidate } from "./example.ts";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Fictional documented-milestone exercise", robots: { index: false, follow: false } };
export default async function PlannedMilestonePreview(input: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  let raw: unknown;
  try { raw = input.searchParams; } catch (error) { unstable_rethrow(error); notFound(); }
  const comparisonDate = plannedMilestoneComparisonDate((await awaitRouteSelectors(raw, unstable_rethrow)).value, unstable_rethrow);
  if (comparisonDate === null) notFound();
  const { rows, candidate, reviews, finalReview, language } = inventedPlannedMilestoneCandidate();
  const checked = materializeDocumentedPlansCandidateFromRows(rows, language, { candidate, reviews, finalReview });
  return <div className="content-page narrow-page">
    <PageIntro eyebrow="Development only / Separate documented plans" title="Fictional planned-milestone exercise">
      <p>All targets, institutions, sources, content hashes and accepted-looking review rows are invented. No actual source, model, database or provider is read and no review decision is written. Existing public v1 and isolated v2 formats are unchanged.</p>
    </PageIntro>
    <p><a href="/evidence-preview">Back to the existing v1 evidence exercise</a>. The separate panel preserves plans as plans.</p>
    <form method="get" action="/evidence-preview/planned-milestones">
      <label htmlFor="milestone-comparison-on">Explicit calendar comparison date</label>
      <input id="milestone-comparison-on" type="date" name="comparisonOn" required defaultValue={comparisonDate} aria-describedby="milestone-comparison-note" />
      <p id="milestone-comparison-note">Choose a date to compare calendar position only. It does not change a target, verify source freshness or establish completion or delay.</p>
      <button type="submit">Compare target periods</button>
    </form>
    <PlannedMilestoneCandidateView candidate={checked.plannedMilestones} comparisonDate={comparisonDate} prefix="milestone-example" />
    <SourceLanguageSidecarView candidate={checked.sourceLanguage} prefix="milestone-language-example" />
    <p>Both supplements refer to this same publication and source-version frame. Each has its own reviews; neither changes the base evidence review date.</p>
    <IssueEvidence issue={checked.issue} />
  </div>;
}
