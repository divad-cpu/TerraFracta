import type { PublicReadResponseDecision } from "./public-read-response.ts";
import { IssueEvidence } from "../app/issue-evidence.tsx";
import { currentIssueHref } from "./current-issue-navigation.ts";
import { CurrentIssueEdition } from "../app/reader-preview/CurrentIssueEdition.tsx";
import { currentIssueIdentity } from "./current-issue-status.ts";
import { readingExplanationHref } from "./current-reading-guide.ts";
import { canonicalPublicIssueRoute, type PublicIssueRoute } from "./server/public-issue-reader.ts";

// Presentation only; only the server connector supplies this checked decision.
// No previous issue is rendered when the latest read is absent or unavailable.
export function PublicIssueReadView({ decision, retryRoute }: {
  decision: PublicReadResponseDecision; retryRoute?: PublicIssueRoute;
}) {
  let retryHref: string | undefined;
  if (decision.status === 404 || decision.status === 503) {
    try {
      // Capture only the checked base scope; retry navigation carries no old edition or selectors.
      const route = canonicalPublicIssueRoute(retryRoute);
      if (route !== null) retryHref = `/reader-preview/${route.jurisdictionSlug}/${route.issueSlug}`;
    } catch { /* A faulty optional route cannot offer a recovery destination. */ }
  }
  const readingGuideReturn = decision.status === 200 ? currentIssueHref(decision.issue, "issue") : undefined;
  const content = <div className="content-page">
    <p className="eyebrow">Local reader preview</p>
    <p>This development view connects the current-candidate reader to the evidence display. No live source or operational reader is configured.</p>
    {decision.status === 200 ? <><h1>Current issue</h1><nav className="current-issue-nav" aria-label="Current dossier views"><a href={currentIssueHref(decision.issue, "issue")}>Issue and evidence</a><a href={currentIssueHref(decision.issue, "sources")}>All source references</a><a href={currentIssueHref(decision.issue, "search")}>Search this issue</a></nav><IssueEvidence issue={decision.issue} readingGuideReturn={readingGuideReturn} /></> :
      <section className="info-band" role="status">
        <h1>{decision.status === 404 ? "No eligible issue found" : "Issue temporarily unavailable"}</h1>
        <p>{decision.status === 404 ? "There is no eligible current issue for this route." :
          "The current read could not supply an eligible issue. Earlier claims are withheld."}</p>
        {retryHref && <p><a href={retryHref}>Check the current issue again</a></p>}
      </section>}
    <p className="reader-recovery"><a href="/issues">Browse the illustrative cases</a> · <a href={readingExplanationHref("methodology", readingGuideReturn)}>Read the evidence method</a></p>
  </div>;
  return decision.status === 200 ? <CurrentIssueEdition key={`${decision.issue.publicationId}:${decision.issue.revision}`} expected={currentIssueIdentity(decision.issue)} latestHref={currentIssueHref(decision.issue, "issue", false)}>{content}</CurrentIssueEdition> : content;
}
