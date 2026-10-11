import type { PublicIssueProjection } from "./public-issue-projection.ts";
import {
  materializePublicIssueFromRows,
  type CandidatePublicReadRows,
} from "./public-read-materializer.ts";

export type PublicReadOutcome =
  | { kind: "absent" }
  | { kind: "rejected" }
  | { kind: "issue"; issue: PublicIssueProjection };

const candidateKeys = [
  "requestedRoute", "country", "dossier", "head", "publication",
  "publication_display_review", "claims", "citations", "sources",
].sort();

// Accept only the closed SQL candidate shape. This maps SQL null to a missing
// route and all malformed/held candidates to one private-data-free outcome.
// A future server must never render or cache a rejected candidate as an issue.
export function interpretPublicReadCandidate(input: unknown): PublicReadOutcome {
  if (input === null) return { kind: "absent" };
  if (typeof input !== "object" || Array.isArray(input)) return { kind: "rejected" };
  const keys = Object.keys(input).sort();
  if (keys.length !== candidateKeys.length ||
      keys.some((key, index) => key !== candidateKeys[index])) {
    return { kind: "rejected" };
  }
  try {
    return {
      kind: "issue",
      issue: materializePublicIssueFromRows(input as CandidatePublicReadRows),
    };
  } catch {
    return { kind: "rejected" };
  }
}
