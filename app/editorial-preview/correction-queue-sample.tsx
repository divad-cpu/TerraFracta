"use client";

import { useState } from "react";
import { parseCorrectionQueueTrial } from "../../src/correction-queue-trial.ts";

export function CorrectionQueueSample({ input }: { input: unknown }) {
  const record = parseCorrectionQueueTrial(input);
  const [selection, setSelection] = useState<{ page: number; sample: number | null; visit: number }>({ page: 0, sample: null, visit: 0 });
  const rows = record.reports.slice(selection.page * 2, selection.page * 2 + 2);
  const selected = rows.find(item => item.sample === selection.sample);
  const date = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "medium", timeZone: "Europe/Oslo" });
  function move(change: number) {
    setSelection(previous => {
      if (previous.visit !== selection.visit) return previous;
      const page = Math.max(0, Math.min(2, previous.page + change));
      return page === previous.page ? previous : { page, sample: null, visit: previous.visit + 1 };
    });
  }
  return <div>
    <p>Showing {selection.page * 2 + 1}–{selection.page * 2 + rows.length} of {record.capturedMembers} saved samples. Every state below was awaiting review at capture.</p>
    <ul className="source-preparation__stages" aria-label="Saved invented correction reports">
      {rows.map(item => <li key={item.sample} className="completion-results__card completion-results__card--partial">
        <h3>Sample report {item.sample}</h3><p>Publication revision {item.revision} · Awaiting review</p>
        <button type="button" className="button button--quiet" aria-pressed={selection.sample === item.sample}
          onClick={() => setSelection(previous => previous.visit === selection.visit ? { ...previous, sample: item.sample } : previous)}>Inspect sample {item.sample}</button>
      </li>)}
    </ul>
    <nav aria-label="Saved report pages">
      <button type="button" className="button button--quiet" disabled={selection.page === 0} onClick={() => move(-1)}>Previous page</button>{" "}
      <span aria-live="polite">Page {selection.page + 1} of 3</span>{" "}
      <button type="button" className="button button--quiet" disabled={selection.page === 2} onClick={() => move(1)}>Next page</button>
    </nav>
    <div className="info-band" role="status">
      {selected ? <div><strong>Sample report {selected.sample}</strong><p>Filed against revision {selected.revision} at <time dateTime={selected.reportedAt}>{date.format(new Date(selected.reportedAt))}</time> Oslo time.</p>
        <p>Saved state: awaiting review. Private explanation, source URL and account identity are withheld.</p></div>
        : <p>Select a saved sample to inspect its recorded date and publication revision.</p>}
    </div>
  </div>;
}
