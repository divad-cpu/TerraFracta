import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageIntro } from "../components";
import { ReviewRehearsal } from "./review-rehearsal";
import { ReadGateRehearsal } from "./read-gate-rehearsal";
import { FictionalReviewDesk } from "./fictional-review-desk";
import { FictionalSavedRunImportView } from "../../src/fictional-saved-run-import-view.tsx";
import { fictionalUpdateReport } from "../update-preview/example";
import { CorrectionIntakeTrialView } from "../../src/correction-intake-trial-view";
import { CorrectionReviewTrialView } from "../../src/correction-review-trial-view";
import { CorrectionRecoveryTrialView } from "../../src/correction-recovery-trial-view";
import { CorrectionQueueTrialView } from "../../src/correction-queue-trial-view";
import { CorrectionReviewOperationView } from "../../src/correction-review-operation-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Synthetic editorial review desk" };

export default function EditorialPreview() {
  if (process.env.NODE_ENV !== "development") notFound();

  return (
    <div className="content-page">
      <PageIntro eyebrow="Development only / Editorial workspace" title="Review desk">
        <p>Inspect saved fictional update results from the local rehearsal archive. This desk cannot start an update, approve a source or publish information.</p>
      </PageIntro>
      <div className="info-band"><h2>Recorded exception workspace</h2><p>Follow a recorded run through held candidates, captured comparison, source checks and stored publication history. Each read keeps its own scope and date.</p><Link className="arrow-link" href="/editorial-preview/exceptions">Open the exception workspace</Link></div>
      <div className="info-band"><h2>Candidate beside exact source text</h2><p>Inspect an unverified extraction with selected and earlier source passages. Publication and held-decision records remain unconnected.</p><Link className="arrow-link" href="/editorial-preview/extraction-sample">Inspect invented extraction evidence</Link></div>
      <div className="info-band"><h2>Selected HTML source text</h2><p>Compare explicitly selected parsed text from two invented HTML originals, with separate original and derived identities. Storage and source qualification remain unconnected.</p><Link className="arrow-link" href="/editorial-preview/html-sample">Inspect invented HTML text comparison</Link></div>
      <div className="info-band"><h2>HTML extraction beside both originals</h2><p>Inspect an illustrative stored-byte receipt, the exact request identity and an unverified proposal beside current and earlier selected HTML text. These supplied examples establish no authenticated storage or editorial approval.</p><Link className="arrow-link" href="/editorial-preview/html-extraction-sample">Inspect invented HTML extraction evidence</Link><p><Link href="/editorial-preview/html-preparation-history">Choose an illustrative historical HTML preparation</Link></p><p><Link href="/editorial-preview/html-capture-history">Choose a recorded HTML preparation and saved composition explicitly</Link></p><p><Link href="/editorial-preview/html-initial-capture-history">Choose a recorded initial HTML candidate with an empty current head</Link></p></div>
      <div className="info-band"><h2>Native text from a PDF</h2><p>Inspect a separate invented PDF through bounded local text extraction. Physical page positions and derived text remain distinct from visual reading, source qualification and the HTML examples.</p><Link className="arrow-link" href="/editorial-preview/pdf-inspection">Inspect invented PDF text</Link><p><Link href="/editorial-preview/pdf-held-preparation">Inspect a detached PDF candidate</Link></p><p><Link href="/editorial-preview/pdf-preparation-history">Inspect a saved historical PDF preparation</Link></p><p><a href="/editorial-preview/pdf-capture-history">Captured PDF whole-issue example</a>{" · "}<Link href="/editorial-preview/pdf-append-review">Inspect a separate PDF whole-issue preparation example</Link>{" · "}<Link href="/editorial-preview/pdf-initial-capture">Inspect an invented captured PDF candidate</Link></p></div>
      <div className="info-band"><h2>Historical candidate preparation</h2><p>Follow one invented stored preparation through its supplied historical context to the exact source passages. Current qualification and actual held capture remain open.</p><Link className="arrow-link" href="/editorial-preview/preparation-sample">Inspect invented historical preparation</Link><p><Link href="/editorial-preview/preparation-history">Choose a recorded invented preparation</Link></p><p><Link href="/editorial-preview/append-review-sample">Inspect an append-only whole-issue preparation</Link></p>
    <p><a href="/editorial-preview/capture-sample">Inspect an invented saved whole-issue composition and its recorded comparison</a></p><p><a href="/editorial-preview/capture-history">Choose a recorded preparation and its saved composition explicitly</a></p><p><a href="/editorial-preview/initial-capture-sample">Inspect a separately saved initial candidate and its provenance</a></p><p><a href="/editorial-preview/initial-capture-history">Choose a preparation and its saved initial candidate explicitly</a></p><p><a href="/editorial-preview/preparation-before-storage">Inspect a recorded candidate before preparation storage</a></p><p><a href="/editorial-preview/context-sample">Inspect recorded issue context before preparation</a></p></div>
      <FictionalReviewDesk baseline={fictionalUpdateReport} />
      <FictionalSavedRunImportView />
      <div className="info-band"><h2>Private error diagnostics</h2><p>Inspect recorded faults, group repeated reports and download a closed JSON report for requested investigation. Missing records do not establish system health.</p><Link className="arrow-link" href="/diagnostics-preview">Open recorded errors <span aria-hidden="true">↗</span></Link></div>
      <div className="info-band"><h2>Recorded source and publication audit</h2><p>Choose a stored run and issue to inspect registration settings, historical checks and revision metadata. These records do not establish current source health or public visibility; operational access remains unconfigured.</p><Link className="arrow-link" href="/editorial-preview/audit/select">Choose a recorded audit <span aria-hidden="true">↗</span></Link></div>
      <div className="info-band"><h2>One controlled correction lifecycle</h2><p>The reusable local exercise binds prepared request, confirmed intake, queue membership, review and read-only event recovery to one fictional execution. Its default connection is unavailable.</p><Link className="arrow-link" href="/editorial-preview/corrections">Inspect the controlled correction workflow</Link></div>
      <CorrectionIntakeTrialView />
      <CorrectionQueueTrialView />
      <CorrectionReviewTrialView />
      <CorrectionReviewOperationView supervised />
      <CorrectionRecoveryTrialView />
      <details><summary>Separate illustrative control exercises</summary><ReviewRehearsal /><ReadGateRehearsal /></details>
      <div className="info-band">
        <h2>Current-issue reader connection</h2>
        <p>The local reader connects one route to a checked current issue or a withheld result. Its operational provider is not configured.</p>
        <Link className="arrow-link" href="/reader-preview/norway/housing-costs">Inspect the unconfigured reader <span aria-hidden="true">↗</span></Link>
      </div>
      <div className="info-band">
        <strong>No editorial action is available here.</strong>
        <p>The saved examples remain invented and unpublished. Authenticated live record access, source monitoring and exception resolution need separate implementation and verification.</p>
      </div>
    </div>
  );
}
