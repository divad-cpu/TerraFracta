import { createHash } from "node:crypto";
import { recordedIssuePreparationContext } from "./server/recorded-issue-preparation-context.ts";
import { recordedProposalBaseSchema } from "./operator-proposal-capture.ts";

export function IssuePreparationContextView({record}:{record:unknown}){
 const admitted=recordedIssuePreparationContext(record);
 if(admitted===null)return <section role="status"><h2>Recorded preparation context unavailable</h2><p>The complete stored observation and independent expectations could not be matched. No partial held decision, issue, baseline or source detail is displayed.</p></section>;
 if(admitted.result.kind==="no_match")return <section role="status"><h2>No matching recorded context</h2><p>The supplied observation returned no matching tuple. A missing or populated head is not an observed empty head. This does not authorize issue creation, a retry or a write.</p><p>Recorded observation: <time dateTime={admitted.result.observedAt}>{admitted.result.observedAt}</time>. No fresh read is performed.</p></section>;
 const c=admitted.result.context,h=c.held,i=c.issue;
 const baseline=admitted.kind==="known_base"&&admitted.result.kind==="ok"?recordedProposalBaseSchema.parse(JSON.parse(admitted.result.context.canonicalBaselineJson)):null;
 const canonicalFingerprint=admitted.kind==="known_base"&&admitted.result.kind==="ok"?createHash("sha256").update(admitted.result.context.canonicalBaselineJson,"utf8").digest("hex"):null;
 return <section aria-labelledby="preparation-context-heading"><h2 id="preparation-context-heading" tabIndex={-1}>Observed issue context before preparation</h2>
  <p>Entirely invented historical observation. Opening this page makes no database, source or model request and does not renew the recorded time. Matching stored correspondence is not assignment, factual support, reuse rights or publication approval.</p>
  <nav aria-label="Sections of this recorded context"><a href="#context-held">Held candidate</a>{" · "}<a href="#context-issue">Issue and publication head</a>{" · "}<a href="#context-time">Distinct observation times</a></nav>
  <section id="context-held" tabIndex={-1}><h3>Explicit held candidate and source identity</h3><dl><dt>Run</dt><dd><code>{h.run_id}</code></dd><dt>Held decision</dt><dd><code>{h.decision_id}</code></dd>
   <dt>Item key</dt><dd><bdi>{h.item_key}</bdi></dd><dt>Source version</dt><dd><code>{h.source_version_id}</code></dd><dt>Original content fingerprint</dt><dd><code>{h.content_sha256}</code></dd>
   <dt>Selected location</dt><dd><bdi>{h.locator}</bdi></dd><dt>Held decision recorded</dt><dd><time dateTime={h.decided_at}>{h.decided_at}</time></dd></dl>
   <p>These fields match the separately supplied five-field source expectation. The observation does not prove that this source supports a proposed assertion or that its qualification remains active.</p></section>
  <section id="context-issue" tabIndex={-1}><h3>Selected issue and observed publication head</h3><dl><dt>Issue</dt><dd><code>{i.issue_id}</code></dd><dt>Jurisdiction</dt><dd><bdi>{i.jurisdiction_id}</bdi> / <code>{i.jurisdiction_slug}</code></dd>
   <dt>Issue route</dt><dd><code>{i.issue_slug}</code></dd><dt>Issue created</dt><dd><time dateTime={i.created_at}>{i.created_at}</time></dd></dl>
   {baseline===null?<><p>An existing publication-head row was observed with both current fields empty. No baseline was selected or fabricated.</p><p>Empty current head does not mean that the issue has never had a publication. The empty-head read does not examine publication history.</p></>:<>
    <p>A specific baseline was observed in the selected historical snapshot. This does not establish its present public eligibility or permit replacing the issue.</p>
    <dl><dt>Baseline publication</dt><dd><code>{baseline.id}</code></dd><dt>Historical revision</dt><dd>{baseline.revision}</dd><dt>Baseline title</dt><dd><bdi>{baseline.snapshot.title}</bdi></dd><dt>Baseline summary</dt><dd><bdi>{baseline.snapshot.summary}</bdi></dd>
     <dt>Recorded evidence-review date</dt><dd><time dateTime={baseline.snapshot.lastEvidenceReviewOn}>{baseline.snapshot.lastEvidenceReviewOn}</time></dd><dt>Historical statements</dt><dd>{baseline.snapshot.claims.length}</dd></dl>
    {c.headComparison==="matched"?<p>The observed baseline fingerprint and change time match the independently supplied head expectation. This remains a historical comparison, not editorial acceptance.</p>:<p>No independent head fingerprint was supplied. Observing a baseline does not make that unpaired head independently matched.</p>}
    <details><summary>Inspect the separate original and canonical baseline fingerprints</summary><dl><dt>Original stored baseline</dt><dd><code>{c.baselineSha256}</code></dd><dt>Canonical baseline</dt><dd><code>{canonicalFingerprint}</code></dd><dt>Head changed</dt><dd><time dateTime={i.head.changed_at??undefined}>{i.head.changed_at}</time></dd></dl>
     <p>The original baseline spelling is retained separately from its canonical representation. Byte correspondence does not authenticate the supplied records.</p></details>
   </>}
  </section>
  <section id="context-time" tabIndex={-1}><h3>Distinct recorded observation times</h3><dl><dt>Database statement observation</dt><dd><time dateTime={c.observedAt}>{c.observedAt}</time></dd><dt>Retained after-read UTC observation</dt><dd><time dateTime={c.trustedObservedAt}>{c.trustedObservedAt}</time></dd></dl>
   <p>The read describes its repeatable-read snapshot. Later changes are not excluded by opening this recorded view. An empty-head observation and an unpaired known-base observation are different states.</p></section>
  <p>Before a proposal can be prepared, original extraction evidence and independently supplied wording, support, translation and review-date context are still required. No claim, preparation store, capture or work lease is created by this view.</p>
  <p><a href="#preparation-context-heading">Back to the context overview</a></p><p>No editorial action is available. Actual authenticated operation, source and rights review, recovery and public-pilot acceptance remain separate.</p>
 </section>;
}
