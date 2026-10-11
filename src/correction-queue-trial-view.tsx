import saved from "../fixtures/fictional_correction_queue_snapshot.json";
import { parseCorrectionQueueTrial } from "./correction-queue-trial.ts";
import { CorrectionQueueSample } from "../app/editorial-preview/correction-queue-sample";

export function CorrectionQueueTrialView() {
  const record = parseCorrectionQueueTrial(saved);
  return <section className="completion-results" aria-labelledby="correction-queue-heading">
    <div className="section-heading"><h2 id="correction-queue-heading">Inspect a saved correction list</h2><span className="tag tag--caution">Before-review sample</span></div>
    <p>The earlier list captured four invented reports. A fifth committed report appeared in a new list; the earlier membership stayed fixed.</p>
    <p>This view preserves the new list before review. Later review outcomes are shown separately. Paging and selection read this saved example and make no requests.</p>
    <CorrectionQueueSample key={record.capturedAt} input={record} />
    <p>Captured <time dateTime={record.capturedAt}>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "medium", timeZone: "Europe/Oslo" }).format(new Date(record.capturedAt))}</time> Oslo time. This is a dated sample, not a live queue or current state. No review or publication action is available.</p>
  </section>;
}
