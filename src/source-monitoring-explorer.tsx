"use client";

import { useState } from "react";
import type { SourceMonitoringFilter } from "./source-monitoring-filter.ts";
import { sourceMonitoringSnapshot } from "./source-monitoring-snapshot.ts";
import { SourceMonitoringView } from "./source-monitoring-view.tsx";

export function SourceMonitoringExplorer({ input }: { input: unknown }) {
  const [filter, setFilter] = useState<SourceMonitoringFilter>({ check: "", permission: "" });
  if (sourceMonitoringSnapshot(input) === null) return <SourceMonitoringView input={input} />;
  return <>
    <fieldset><legend>Filter this supplied invented snapshot</legend>
      <p>Display filters only. Nothing is fetched, rechecked, approved or changed. Totals continue to cover every supplied source observation.</p>
      <label htmlFor="source-monitoring-check-filter">Recorded check</label>
      <select id="source-monitoring-check-filter" value={filter.check} onChange={event => {
        const check = event.currentTarget.value as SourceMonitoringFilter["check"];
        setFilter(current => ({ ...current, check }));
      }}>
        <option value="">All recorded check states</option><option value="not_recorded">No check recorded</option>
        <option value="failed">Recorded check failed</option><option value="coverage_unknown">Coverage unknown</option>
        <option value="incomplete">Incomplete recorded check</option><option value="complete_changed">Complete recorded check; change reported</option>
        <option value="complete_unchanged">Complete recorded check; no change reported</option>
      </select>
      <label htmlFor="source-monitoring-permission-filter">Recorded fetch permission</label>
      <select id="source-monitoring-permission-filter" value={filter.permission} onChange={event => {
        const permission = event.currentTarget.value as SourceMonitoringFilter["permission"];
        setFilter(current => ({ ...current, permission }));
      }}>
        <option value="">All fetch permission observations</option><option value="allowed">Fetch allowed</option>
        <option value="denied">Fetch denied</option><option value="unresolved">Fetch permission unresolved</option>
      </select>
      <button type="button" disabled={filter.check === "" && filter.permission === ""}
        onClick={() => setFilter({ check: "", permission: "" })}>Clear display filters</button>
    </fieldset>
    <SourceMonitoringView input={input} filter={filter} />
  </>;
}
