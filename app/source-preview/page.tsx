import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageIntro } from "../components";
import { SourcePreparationView } from "../../src/source-preparation-view";
import { FrozenSourceTrialView } from "../../src/frozen-source-trial-view";
import { PrivateAttemptReadinessView } from "../../src/private-attempt-readiness-view";
import { CurrentPrivatePreparationView } from "../../src/current-private-preparation-view";
import { CurrentCopyScopeView } from "../../src/current-copy-scope-view";
import { PrivateParentSourceView } from "../../src/private-parent-source-view";
import { PrivateSSBAssessmentView } from "../../src/private-ssb-assessment-view";
import { PrivateCustodianTrialView } from "../../src/private-custodian-trial-view";
import { PrivateCustodianOperationView } from "../../src/private-custodian-operation-view";
import { PrivateRecoveryTrialView } from "../../src/private-recovery-trial-view";
import { PrivateCustodianJournalView } from "../../src/private-custodian-journal-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Source preparation", robots: { index: false, follow: false } };

export default function SourcePreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <div className="content-page narrow-page">
      <PageIntro eyebrow="Development only / Source preparation" title="Preparing the first source">
        <p>Follow the recorded preparation for the first private source attempt. Review, collection and publication each have a clear status.</p>
      </PageIntro>
      <SourcePreparationView>
        <CurrentPrivatePreparationView />
        <CurrentCopyScopeView />
        <PrivateParentSourceView />
        <PrivateAttemptReadinessView />
        <details className="evidence-disclosure"><summary>Saved collection and recovery trials</summary>
          <p>These development records explain the checked path and its failures. Their dated outcomes do not establish current readiness for a real collection.</p>
          <FrozenSourceTrialView />
          <PrivateCustodianTrialView />
          <PrivateCustodianJournalView />
          <PrivateCustodianOperationView />
          <PrivateRecoveryTrialView />
          <PrivateSSBAssessmentView />
        </details>
        <div className="info-band"><strong>What happens next</strong><p>Operation is planned for NAS once that system is ready. The owner has declared that the existing PC raw folder is not currently copied and must stay excluded from future copies. Select and independently review the NAS accounts, storage, cleanup and connected path before the approved private attempt. The PC cleanup installation does not establish NAS readiness.</p></div>
        <p><Link className="arrow-link" href="/update-preview">Explore the fictional update demonstration <span aria-hidden="true">↗</span></Link></p>
      </SourcePreparationView>
    </div>
  );
}
