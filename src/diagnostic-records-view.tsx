import { diagnosticCodes } from "./error-diagnostics.ts";
import type { DiagnosticReport } from "./diagnostic-report.ts";

// Shared bounded presentation for current inspections and selected exports.
// Filenames, exception bodies and extra fields never reach this component.
export function DiagnosticRecords({ events, page }: { events: DiagnosticReport["events"]; page: number }) {
  return events.length ? <ol className="diagnostic-records" start={(page - 1) * 25 + 1}>{events.map(event => <li key={event.eventId}><article>
    <h3>{diagnosticCodes[event.code].location}</h3><dl>
      <div><dt>Error reference</dt><dd><code>{event.eventId}</code></dd></div>
      <div><dt>Code / reported origin</dt><dd>{event.code} / {event.origin}</dd></div>
      <div><dt>Recorded at</dt><dd><time dateTime={event.occurredAt}>{event.occurredAt}</time></dd></div>
    </dl></article></li>)}</ol> : <div className="empty-state"><h3>No matching recorded event</h3>
    <p>Try removing the function, origin or reference filter. Missing records do not prove that a reported fault did not happen.</p></div>;
}
