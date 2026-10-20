"use client";

import { useState } from "react";
import type { SourceMonitoringFilter } from "./source-monitoring-filter.ts";
import { sourceMonitoringSnapshot } from "./source-monitoring-snapshot.ts";
import { SourceMonitoringView, registrationLabels, dueLabels } from "./source-monitoring-view.tsx";

export function SourceMonitoringExplorer({ input }: { input: unknown }) {
  // Native control values remain untrusted until the shared finite filter parser.
  const [filter, setFilter] = useState<{ check: string; permission: string; registration?: string; due?: string }>({ check: "", permission: "" });
  function change(axis: keyof SourceMonitoringFilter, event: { readonly currentTarget: HTMLSelectElement }) {
    let value: string;
    try { const observed = event.currentTarget.value; value = typeof observed === "string" ? observed : "invalid"; }
    catch { value = "invalid"; }
    setFilter(current => ({ ...current, [axis]: value }));
  }
  if (sourceMonitoringSnapshot(input) === null) return <SourceMonitoringView input={input} />;
  return <>
    <fieldset><legend>Filter this supplied invented snapshot</legend>
      <p>Display filters only. Nothing is fetched, rechecked, approved or changed. Totals continue to cover every supplied source observation.</p>
      <label htmlFor="source-monitoring-check-filter">Recorded check</label>
      <select id="source-monitoring-check-filter" value={filter.check} onChange={event => change("check", event)}>
        <option value="">All recorded check states</option><option value="not_recorded">No check recorded</option>
        <option value="failed">Recorded check failed</option><option value="coverage_unknown">Coverage unknown</option>
        <option value="incomplete">Incomplete recorded check</option><option value="complete_changed">Complete recorded check; change reported</option>
        <option value="complete_unchanged">Complete recorded check; no change reported</option>
      </select>
      <label htmlFor="source-monitoring-permission-filter">Recorded fetch permission</label>
      <select id="source-monitoring-permission-filter" value={filter.permission} onChange={event => change("permission", event)}>
        <option value="">All fetch permission observations</option><option value="allowed">Fetch allowed</option>
        <option value="denied">Fetch denied</option><option value="unresolved">Fetch permission unresolved</option>
      </select>
      <label htmlFor="source-monitoring-registration-filter">Recorded registration</label>
      <select id="source-monitoring-registration-filter" value={filter.registration ?? ""} onChange={event => change("registration", event)}>
        <option value="">All registration observations</option>{Object.entries(registrationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <label htmlFor="source-monitoring-due-filter">Recorded due observation</label>
      <select id="source-monitoring-due-filter" value={filter.due ?? ""} onChange={event => change("due", event)}>
        <option value="">All due observations</option>{Object.entries(dueLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <button type="button" disabled={filter.check === "" && filter.permission === "" && !filter.registration && !filter.due}
        onClick={() => setFilter({ check: "", permission: "" })}>Clear display filters</button>
    </fieldset>
    <SourceMonitoringView input={input} filter={filter} />
  </>;
}
