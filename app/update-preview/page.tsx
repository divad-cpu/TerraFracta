import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageIntro, Tag } from "../components";
import { fictionalUpdateReport } from "./example";
import { UpdateOperation } from "./operation";
import { FictionalCompletionResults } from "./completion";
import { FictionalResponseResults } from "./responses";
import { FictionalPipelineResults } from "./pipeline";
import { FictionalCaptureFailureResult } from "./capture-failure";
import { FictionalAuthenticatedPublicationResult } from "./authenticated-publication";
import { WeeklyRehearsalStatusView } from "../../src/weekly-rehearsal-status-view";
import { WeeklyRehearsalReportView } from "../../src/weekly-rehearsal-report-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Fictional update report preview" };

export default function UpdatePreview() {
  if (process.env.NODE_ENV !== "development") notFound();

  return (
    <div className="content-page narrow-page">
      <PageIntro eyebrow="Development only / Update operations" title="Update report preview">
        <p>Start a local rehearsal and inspect its decisions and source locations. Every entry is fictional. The same checks serve both manual and weekly triggers.</p>
        <div className="intro-tags"><Tag tone="caution">Entirely fictional</Tag><span>Not available in production mode</span></div>
      </PageIntro>
      <UpdateOperation initialReport={fictionalUpdateReport} />
      <WeeklyRehearsalStatusView />
      <WeeklyRehearsalReportView />
      <FictionalPipelineResults />
      <FictionalAuthenticatedPublicationResult />
      <FictionalCaptureFailureResult />
      <details><summary>Earlier separate completion trials</summary><FictionalCompletionResults /></details>
      <FictionalResponseResults />
      <div className="info-band"><strong>Current product limit</strong><p>This local operation calculates invented findings and saves fictional receipts. A real update needs qualified sources, an authenticated operator view and a checked publication transaction.</p></div>
    </div>
  );
}
