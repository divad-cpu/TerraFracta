import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OperatorWorkspaceNavigation } from "../../../src/operator-workspace-navigation-view.tsx";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Recorded exception workspace", robots: { index: false, follow: false } };
export default async function ExceptionWorkspace(input: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const query = await input.searchParams;
  if (Object.keys(query).length !== 0) return <div className="content-page"><h1>Check the workspace link</h1><p>This overview accepts no record or provider selectors. No private reader was called.</p><a href="/editorial-preview/exceptions">Open the workspace overview</a></div>;
  return <div className="content-page"><header className="page-intro"><p className="eyebrow">Development only / Recorded exceptions</p><h1>Follow a held candidate</h1>
    <p>Start with a recorded run, inspect its holds and open separately captured proposals. Records remain private and unverified; this workspace cannot collect, approve, edit or publish.</p></header>
    <OperatorWorkspaceNavigation active="overview" />
    <ol className="workspace-reading-path"><li><h2>Choose a recorded run</h2><p>Read its stored state and inspection date. Issue choices belong to the run's jurisdiction; they are not evidence that the run updated those issues.</p><a href="/editorial-preview/audit/select">Choose a run and issue</a></li>
      <li><h2>Inspect the hold</h2><p>Read fixed checks and recorded reasons. A held decision has no issue target; open its exact captured comparison if one exists.</p></li>
      <li><h2>Compare the captured wording</h2><p>The separate read shows the recorded base, proposed text, references, conflicts, translation status and affected page. A missing capture cannot be reconstructed from a hash.</p></li>
      <li><h2>Inspect recorded source checks and history</h2><p>Use the checked proposal's exact target or explicitly choose an issue. Each audit shows its own inspection date, historical checks and bounded stored revision metadata.</p></li></ol>
    <section className="info-band"><h2>Current source health is unavailable</h2><p>Historical checks are available through a selected audit. They do not assess source health now. The default record connections remain unconfigured.</p></section>
    <p><a href="/editorial-preview">Back to the review desk</a></p>
  </div>;
}
