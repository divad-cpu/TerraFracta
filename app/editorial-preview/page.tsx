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
