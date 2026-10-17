import { feedReport } from "./feed_discovery_fixture.mjs";

// Invented consistency operands, not another original-source observation.
// The earlier receipt may differ, but its byte-identical parsed window may not.
export function equalWindowReport() {
  const report = feedReport();
  report.previous = structuredClone(report.current);
  report.previous.source.source_version_id = "10000000-0000-4000-8000-000000000001";
  report.previous.source.retrieved_at = "2026-10-14T11:00:00.000000Z";
  for (const entry of report.previous.entries) entry.source_version_id = report.previous.source.source_version_id;
  report.source_bytes_changed = false;
  report.changes = report.current.entries.map((current, index) => ({
    state: "reobserved_metadata", current, previous: report.previous.entries[index],
  }));
  report.not_reobserved = [];
  return report;
}
export function changedWindowReport() {
  const report = equalWindowReport();
  report.current.source.content_sha256 = "f".repeat(64);
  for (const entry of report.current.entries) entry.source_content_sha256 = report.current.source.content_sha256;
  report.source_bytes_changed = true;
  return report;
}
