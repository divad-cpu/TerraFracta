import saved from "../fixtures/local_private_attempt_readiness_snapshot.json";
import { parsePrivateAttemptReadiness } from "./private-attempt-readiness.ts";

const labels = {
  cleanupSnapshot: "Installed cleanup code",
  cleanupUnitBytes: "Cleanup settings",
  cleanupManager: "Automatic cleanup trigger",
  cleanupHistory: "Latest cleanup record",
  selectedRawFolder: "Empty private storage",
} as const;

export function PrivateAttemptReadinessView() {
  const record = parsePrivateAttemptReadiness(saved);
  return (
    <section className="completion-results" aria-labelledby="private-readiness-heading">
      <div className="section-heading"><h2 id="private-readiness-heading">Before the first private collection</h2><span className="tag tag--caution">Collection held</span></div>
      <p className="completion-results__intro">These saved checks describe the local preparation. They do not start collection or approve publication.</p>
      <ul className="source-preparation__stages" role="list" aria-label="Recorded storage checks">
        {record.checks.map((entry) => (
          <li key={entry.key} className={`completion-results__card completion-results__card--${entry.state === "observed" ? "completed" : "partial"}`}>
            <h3>{labels[entry.key]}</h3>
            <p className={`tag tag--${entry.state === "observed" ? "good" : "caution"}`}>{entry.state === "observed" ? "Observed at this check" : "Needs attention"}</p>
          </li>
        ))}
      </ul>
      <div className="info-band"><strong>Remaining before collection</strong><p>The selected NAS is not ready. Verify its private saving account, copy exclusions, collection entry and cleanup controls when installation is accepted. These saved PC checks do not establish NAS readiness.</p></div>
      <details className="evidence-disclosure">
        <summary>What this status means</summary>
        <p>The source review already supports one private attempt. Application access expires after 30 days; automatic cleanup runs while the machine is on or at startup. A successful empty-folder check does not prove that real files have been deleted or that other copies are excluded.</p>
        <p>Recorded <time dateTime={record.recordedAt}>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" }).format(new Date(record.recordedAt))}</time> Oslo. This is a saved observation, not current live health. Changed settings, interrupted cleanup or existing files require another check.</p>
      </details>
    </section>
  );
}
