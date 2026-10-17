"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { observeClientError } from "../../src/client-error-diagnostics.ts";
import { fictionalUpdateResultSchema, type FictionalUpdateResult } from "../../src/fictional-update-result";
import { updateRunReportSchema, type UpdateRunReport } from "../../src/update-run-report";
import { FictionalSavedRunView } from "../../src/fictional-saved-run-view";
import { FictionalHistory } from "../update-preview/history";
import { FictionalComparison } from "../update-preview/comparison";
import { SavedRunComparison } from "./saved-run-comparison";

export function FictionalReviewDesk({ baseline }: { baseline: UpdateRunReport }) {
  const [selected, setSelected] = useState<{ value: FictionalUpdateResult; visit: number } | null>(null);
  const [earlier, setEarlier] = useState<{ value: FictionalUpdateResult; visit: number } | null>(null);
  const [navigationFailureVisit, setNavigationFailureVisit] = useState<number | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const visit = useRef(0);
  const comparisonVisit = useRef(0);
  const reportedNavigationVisit = useRef<number | null>(null);
  const activeDesk = useRef(false), deskVisit = useRef(0);
  const [admittedDeskVisit, setAdmittedDeskVisit] = useState<number | null>(null);
  const representedDeskVisit = deskVisit.current;
  const admittedDesk = activeDesk.current && admittedDeskVisit === representedDeskVisit;
  const ownsDesk = () => admittedDesk && activeDesk.current && deskVisit.current === representedDeskVisit;
  const selectedVisit = selected?.visit ?? 0;
  const pairedVisit = comparisonVisit.current;
  const ownsComparison = () => ownsDesk() && visit.current === selectedVisit && comparisonVisit.current === pairedVisit;
  let checkedSelected, checkedEarlier, checkedBaseline;
  try { const checked = fictionalUpdateResultSchema.safeParse(selected?.value); checkedSelected = checked.success ? checked.data : null; }
  catch { checkedSelected = null; }
  try { const checked = fictionalUpdateResultSchema.safeParse(earlier?.value); checkedEarlier = checked.success ? checked.data : null; }
  catch { checkedEarlier = null; }
  try { const checked = updateRunReportSchema.safeParse(baseline); checkedBaseline = checked.success ? checked.data : null; }
  catch { checkedBaseline = null; }
  useLayoutEffect(() => () => {
    activeDesk.current = false; deskVisit.current++; visit.current++; comparisonVisit.current++;
  }, []);
  useEffect(() => {
    activeDesk.current = true;
    setAdmittedDeskVisit(++deskVisit.current);
    return () => { activeDesk.current = false; deskVisit.current++; visit.current++; comparisonVisit.current++; };
  }, []);
  useEffect(() => {
    const isCurrent = () => ownsDesk() && visit.current === selectedVisit;
    if (!checkedSelected || !isCurrent()) return;
    let failed = false;
    try { panel.current?.scrollIntoView({ behavior: "auto", block: "start" }); }
    catch { failed = true; }
    if (!isCurrent()) return;
    try { panel.current?.focus({ preventScroll: true }); }
    catch { failed = true; }
    if (failed && isCurrent() && reportedNavigationVisit.current !== selectedVisit) {
      reportedNavigationVisit.current = selectedVisit;
      setNavigationFailureVisit(selectedVisit);
      observeClientError("browser_runtime");
    }
  }, [selected]);
  return <section aria-labelledby="rehearsal-desk-heading">
    <h2 id="rehearsal-desk-heading">Inspect stored rehearsal outcomes</h2>
    <p>Load the existing local history, then select a run. Read its holds, source coverage and proposed changes without starting an update.</p>
    <FictionalHistory onInspect={value => { if (!ownsDesk()) return; comparisonVisit.current++; setSelected({ value, visit: ++visit.current }); }}
      onUseEarlier={value => { if (ownsDesk()) setEarlier({ value, visit: ++comparisonVisit.current }); }} />
    {selected && <div className="reader-recovery">
      <button type="button" className="button button--quiet" onClick={() => {
        if (!ownsDesk() || visit.current !== selectedVisit || comparisonVisit.current !== pairedVisit) return;
        // Revoke retained child actions before React clears their presentation.
        visit.current++; comparisonVisit.current++;
        setSelected(null); setEarlier(null); setNavigationFailureVisit(null);
      }}>Clear inspected run and comparison</button>
      <p>This clears only the selections shown here. Saved receipts and the loaded history are preserved.</p>
    </div>}
    {earlier && <div className="info-band" role="status">{checkedEarlier
      ? <><p>Earlier run selected: <time dateTime={checkedEarlier.execution.executedAt}>{checkedEarlier.execution.executedAt}</time>. Inspect a later saved run to compare checked observations.</p>
        <details><summary>Earlier saved execution reference</summary><code>{checkedEarlier.execution.id}</code></details></>
      : <p>Earlier run unavailable. Its comparison details are withheld; select another checked saved result.</p>}
      <button type="button" className="button button--quiet" onClick={() => { if (!ownsDesk() || comparisonVisit.current !== pairedVisit) return; comparisonVisit.current++; setEarlier(null); }}>Clear comparison selection</button></div>}
    {checkedSelected && navigationFailureVisit === selectedVisit && <p className="info-band" role="status">
      The saved run is ready below. Automatic navigation was unavailable. <a href="#selected-saved-run">Read the selected run</a>.
    </p>}
    {selected ? <div id="selected-saved-run" ref={panel} tabIndex={-1}>
      <FictionalSavedRunView key={selectedVisit} input={checkedSelected} isCurrent={() => ownsDesk() && visit.current === selectedVisit} />
      {checkedSelected && checkedEarlier && <SavedRunComparison key={pairedVisit} earlier={checkedEarlier} later={checkedSelected} isCurrent={ownsComparison} />}
      {!earlier && checkedSelected?.execution.scenario === "revised_value" && checkedSelected.report.fictionalCandidate &&
        (checkedBaseline?.fictionalCandidate
          ? <FictionalComparison key={`${checkedSelected.execution.id}:${pairedVisit}`} baseline={checkedBaseline.fictionalCandidate} candidate={checkedSelected.report.fictionalCandidate} isCurrent={ownsComparison} />
          : <p className="info-band" role="status">Saved example unavailable. Its baseline comparison details are withheld.</p>)}
    </div> : <p className="info-band" role="status">No saved run selected. The live operator, source monitor and correction queue remain unconnected.</p>}
  </section>;
}
