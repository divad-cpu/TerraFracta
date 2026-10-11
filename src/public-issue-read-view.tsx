import type { PublicReadResponseDecision } from "./public-read-response.ts";
import { IssueEvidence } from "../app/issue-evidence.tsx";
import { currentIssueHref } from "./current-issue-navigation.ts";
import { CurrentIssueEdition } from "../app/reader-preview/CurrentIssueEdition.tsx";
import { currentIssueIdentity } from "./current-issue-status.ts";

// Presentation only; only the server connector supplies this checked decision.
// No previous issue is rendered when the latest read is absent or unavailable.
export function PublicIssueReadView({ decision }: { decision: PublicReadResponseDecision }) {
  const content = <div className="content-page">
    <p className="eyebrow">Local reader preview</p>
    <p>This development view connects the current-candidate reader to the evidence display. No live source or operational reader is configured.</p>
    {decision.status === 200 ? <><h1>Current issue</h1><nav className="current-issue-nav" aria-label="Current dossier views"><a href={currentIssueHref(decision.issue, "issue")}>Issue and evidence</a><a href={currentIssueHref(decision.issue, "sources")}>All source references</a><a href={currentIssueHref(decision.issue, "search")}>Search this issue</a></nav><IssueEvidence issue={decision.issue} /></> :
      <section className="info-band" role="status">
        <h1>{decision.status === 404 ? "No eligible issue found" : "Issue temporarily unavailable"}</h1>
        <p>{decision.status === 404 ? "There is no eligible current issue for this route." :
          "The current read could not supply an eligible issue. Earlier claims are withheld."}</p>
      </section>}
    <p className="reader-recovery"><a href="/issues">Browse the illustrative cases</a> · <a href="/methodology">Read the evidence method</a></p>
  </div>;
  return decision.status === 200 ? <CurrentIssueEdition key={`${decision.issue.publicationId}:${decision.issue.revision}`} expected={currentIssueIdentity(decision.issue)} latestHref={currentIssueHref(decision.issue, "issue", false)}>{content}</CurrentIssueEdition> : content;
}
