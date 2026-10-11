"use client";
import { useEffect, useState, type ReactNode } from "react";
import { requestCurrentIssueStatus, type CurrentIssueIdentity, type CurrentIssueVerdict } from "../../src/current-issue-status.ts";
import { startCurrentIssueWatch } from "../../src/current-issue-watch.ts";

export function CurrentIssueEdition({ expected, latestHref, children }: { expected: CurrentIssueIdentity; latestHref: string; children: ReactNode }) {
  const [status, setStatus] = useState<CurrentIssueVerdict>({ kind: "current" });
  useEffect(() => {
    let active = true;
    const changed = (value: CurrentIssueVerdict) => { if (active) setStatus(value); };
    const watch = startCurrentIssueWatch(expected, changed, requestCurrentIssueStatus,
      { visible: () => document.visibilityState !== "hidden", interval: setInterval, clearInterval, timeout: setTimeout, clearTimeout });
    const visible = () => { if (active) void watch.check(); };
    const retire = () => {
      active = false;
      try { watch.stop(); } catch { /* Visibility still has its own retirement. */ }
      try { document.removeEventListener("visibilitychange", visible); } catch { /* Retained events are inactive. */ }
    };
    try { document.addEventListener("visibilitychange", visible); }
    catch { retire(); setStatus({ kind: "unavailable" }); }
    return retire;
  }, [expected.jurisdictionSlug, expected.issueSlug, expected.issueId, expected.publicationId, expected.revision]);
  if (status.kind === "current") return children;
  return <section className="content-page current-issue-held" role="status" aria-live="polite">
    <p className="eyebrow">Local reader preview / Current publication check</p>
    <h1>{status.kind === "changed" ? "A newer publication is available" : status.kind === "absent" ? "This publication is no longer available" : "Current publication could not be confirmed"}</h1>
    <p>The earlier statements, source references, search results and unsent correction draft are withheld. Open the current view to read a fresh eligible publication.</p>
    <a className="button button--primary" href={latestHref}>Open the current view</a>
    <p className="small-note">This development check runs when visible and every 15 seconds, with a three-second read deadline. It is not instantaneous withdrawal or an accepted live monitoring service.</p>
  </section>;
}
