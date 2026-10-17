import type { Metadata } from "next";
import { notFound, unstable_rethrow } from "next/navigation";
import { awaitRouteSelectors } from "../../../src/await-route-selectors.ts";
import { OperatorWorkspaceNavigation } from "../../../src/operator-workspace-navigation-view.tsx";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Recorded exception workspace", robots: { index: false, follow: false } };
// Confirm an interruption using stable, cause-free metadata. Next's classifier
// may itself fail while observing an ordinary error's properties or cause.
// Such an observation fault is not a framework interruption.
function rethrowFramework(error: unknown) {
  let interrupted: unknown;
  try { unstable_rethrow(error); return; }
  catch (caught) { interrupted = caught; }
  let confirmed = false;
  try {
    if (interrupted !== null && typeof interrupted === "object") {
      const snapshot = interrupted instanceof Error ? new Error() : Object.create(null);
      Object.defineProperty(snapshot, "cause", { value: undefined });
      for (const field of ["digest", "message", "name", "$$typeof"] as const) {
        if (field in interrupted) Object.defineProperty(snapshot, field, { value: (interrupted as Record<string, unknown>)[field], configurable: true });
      }
      try { unstable_rethrow(snapshot); }
      catch (caught) { confirmed = caught === snapshot; }
    }
  } catch { /* Unreadable interruption metadata is an ordinary unavailable selector. */ }
  if (confirmed) throw interrupted;
}

export default async function ExceptionWorkspace(input: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  let valid = false;
  try {
    const query = (await awaitRouteSelectors(input.searchParams, rethrowFramework)).value;
    valid = query !== null && typeof query === "object" && !Array.isArray(query) && Object.keys(query).length === 0;
  } catch (error) { rethrowFramework(error); /* Ordinary selector faults use the existing detail-free recovery. */ }
  if (!valid) return <div className="content-page"><h1>Check the workspace link</h1><p>This overview accepts no record or provider selectors. No private reader was called.</p><a href="/editorial-preview/exceptions">Open the workspace overview</a></div>;
  return <div className="content-page"><header className="page-intro"><p className="eyebrow">Development only / Recorded exceptions</p><h1>Follow a held candidate</h1>
    <p>Start with a recorded run, inspect its holds and open separately captured proposals. Records remain private and unverified; this workspace cannot collect, approve, edit or publish.</p></header>
    <OperatorWorkspaceNavigation active="overview" />
    <ol className="workspace-reading-path"><li><h2>Choose a recorded run</h2><p>Read its stored state and inspection date. Issue choices belong to the run's jurisdiction; they are not evidence that the run updated those issues.</p><a href="/editorial-preview/audit/select">Choose a run and issue</a></li>
      <li><h2>Inspect the hold</h2><p>Read fixed checks and recorded reasons. A held decision has no issue target; open its exact captured comparison if one exists.</p></li>
      <li><h2>Compare the captured wording</h2><p>The separate read shows the recorded base, proposed text, references, conflicts, translation status and affected page. A missing capture cannot be reconstructed from a hash.</p></li>
      <li><h2>Inspect recorded source checks and history</h2><p>Use the checked proposal's exact target or explicitly choose an issue. Each audit shows its own inspection date, historical checks and bounded stored revision metadata.</p></li></ol>
    <section className="info-band"><h2>Current source health is unavailable</h2><p>Historical checks are available through a selected audit. They do not assess source health now. The default record connections remain unconfigured.</p><p><a href="/editorial-preview/source-health">Explore an invented source-monitoring example</a></p></section>
    <p><a href="/editorial-preview">Back to the review desk</a></p>
  </div>;
}
