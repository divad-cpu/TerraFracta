import { checkPublicReadConsistency } from "../../src/public-read-consistency.ts";
import { syntheticReadRows } from "../evidence-preview/example.ts";

export type SyntheticGateSwitches = {
  sourceTitleReviewed: boolean;
  issueTextReviewed: boolean;
  periodLabelReviewed: boolean;
  claimWordingReviewed: boolean;
  publicReuseAllowed: boolean;
  citationSelected: boolean;
};

// Use the same strict offline reader as the fictional evidence page. These
// switches only mutate a cloned fixture in memory; they are never decisions.
export function evaluateSyntheticReadGate(switches: SyntheticGateSwitches): boolean {
  const candidate = structuredClone(syntheticReadRows);
  if (!switches.sourceTitleReviewed) candidate.sources[0].publicReview.decision = "withdrawn";
  if (!switches.issueTextReviewed) candidate.publicationReview.decision = "withdrawn";
  if (!switches.periodLabelReviewed) candidate.claims[0].periodReview.decision = "withdrawn";
  if (!switches.claimWordingReviewed) candidate.claims[0].assertionReview.decision = "withdrawn";
  if (!switches.publicReuseAllowed) candidate.sources[0].allowPublicDerived = false;
  if (!switches.citationSelected) candidate.citations.shift();
  try {
    checkPublicReadConsistency(candidate);
    return true;
  } catch {
    return false;
  }
}
