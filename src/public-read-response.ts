import type { PublicReadOutcome } from "./public-read-outcome.ts";
import type { PublicIssueProjection } from "./public-issue-projection.ts";

export type PublicReadResponseDecision =
  | { status: 200; cacheControl: "no-store"; issue: PublicIssueProjection }
  | { status: 404; cacheControl: "no-store" }
  | { status: 503; cacheControl: "no-store" };

// Pure policy for a future server route. No network response is emitted here.
// Caching remains disabled until rights revocation and correction propagation
// are verified in the actual deployment.
export function decidePublicReadResponse(outcome: PublicReadOutcome): PublicReadResponseDecision {
  switch (outcome.kind) {
    case "issue":
      return { status: 200, cacheControl: "no-store", issue: outcome.issue };
    case "absent":
      return { status: 404, cacheControl: "no-store" };
    case "rejected":
      return { status: 503, cacheControl: "no-store" };
  }
}
