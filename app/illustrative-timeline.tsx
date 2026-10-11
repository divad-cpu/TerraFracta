import type { IllustrativeDate, IllustrativeIssue } from "../src/prototype-contract.ts";
import { EvidenceDisclosure } from "./components";

const stageLabels = {
  planned_example: "Planned example", recorded_example: "Recorded example", not_assessed: "Not assessed",
};

export function IllustrativeDateValue({ date }: { date: IllustrativeDate }) {
  switch (date.precision) {
    case "day": return <time dateTime={date.value}>{date.value} (exact day)</time>;
    case "month": return <time dateTime={date.value}>{date.value} (month only)</time>;
    case "year": return <span>{date.value} (year only)</span>;
    case "period": return <span>{date.label} (illustrative period)</span>;
    case "not_supplied": return <span>Not supplied</span>;
  }
}

// Only the parsed synthetic dossier calls this presenter. Dates are not source
// evidence, and the authored record order/stage is not inferred from time.
export function IllustrativeTimeline({ records }: { records: IllustrativeIssue["timeline"] }) {
  return <div className="timeline">
    <p className="timeline-date-notice">All calendar dates below are invented. Event time and reporting time answer different questions; a planned entry does not establish delivery.</p>
    {records.map((item, index) => <article className="timeline-item" key={`${item.kind}:${index}`}>
      <span className="timeline-item__index">{String(index + 1).padStart(2, "0")}</span>
      <div>
        <p className="eyebrow">{item.kind} · {stageLabels[item.stage]}</p>
        <h3>{item.title}</h3><p>{item.detail}</p>
        <dl className="timeline-dates">
          <div><dt>Event date / period</dt><dd><IllustrativeDateValue date={item.eventDate} /></dd></div>
          <div><dt>Reported / published</dt><dd><IllustrativeDateValue date={item.reportedDate} /></dd></div>
        </dl>
        <EvidenceDisclosure subject={item.kind.toLowerCase()} />
      </div>
    </article>)}
  </div>;
}
