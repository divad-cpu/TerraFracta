"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { statementLabels } from "./issue-display-labels.ts";
import { matchingRecordedReferences, recordedReferenceRoleLabels, type RecordedReferenceEntry } from "./recorded-reference-finder.ts";
import { SearchMatchText } from "./search-match-text.tsx";
import { searchText } from "./search-text.ts";

const empty: Readonly<Record<"query" | "side" | "statementType" | "relation", string>> = Object.freeze({ query: "", side: "", statementType: "", relation: "" });
type Filter = keyof typeof empty;

// The server keys this read-only view by the full checked comparison identity.
// Search is ephemeral local state; there is no request, storage or write port.
export function RecordedReferenceFinder({ entries }: { entries: readonly RecordedReferenceEntry[] }) {
  const prefix = useId(), [filters, setFilters] = useState(empty);
  const alive = useRef(true), inputEpoch = useRef(0), revision = useRef(0);
  const fieldRevisions = useRef({ query: 0, side: 0, statementType: 0, relation: 0 });
  const [, readmit] = useState(0);
  const epoch = inputEpoch.current, clearRevision = revision.current;
  useLayoutEffect(() => {
    const reconnecting = !alive.current;
    alive.current = true;
    if (reconnecting) readmit(value => value + 1);
    return () => { alive.current = false; inputEpoch.current++; revision.current++; };
  }, []);
  const current = () => alive.current && inputEpoch.current === epoch;
  function change(field: Filter, event: { currentTarget: { value: string } }) {
    if (!current()) return;
    const beforeRead = fieldRevisions.current[field], value = event.currentTarget.value;
    if (!current() || fieldRevisions.current[field] !== beforeRead) return;
    fieldRevisions.current[field]++; revision.current++;
    // Independent fields must merge even when React defers several setters.
    setFilters(old => current() ? { ...old, [field]: value } : old);
  }
  const matches = matchingRecordedReferences(entries, filters.query, filters.side, filters.statementType, filters.relation);
  const active = Boolean(filters.query.trim() || filters.side || filters.statementType || filters.relation);
  const help = `${prefix}-help`, status = `${prefix}-status`;
  return <section className="info-band" aria-labelledby={`${prefix}-heading`}>
    <h2 id={`${prefix}-heading`}>Find a reference in this comparison</h2>
    <p id={help}>Search the captured panel, statement type or number, period, reference number, source version, title, location or reference role. Words may match different labels of one occurrence; numbers match as text. This finder changes neither panel nor the complete source-version index.</p>
    <div className="current-source-filters">
      <div><label htmlFor={`${prefix}-query`}>Search captured reference labels</label>
        <input id={`${prefix}-query`} type="search" maxLength={80} value={filters.query} aria-describedby={`${help} ${status}`} aria-invalid={searchText(filters.query).kind === "invalid"} onChange={event => change("query", event)} /></div>
      <div><label htmlFor={`${prefix}-side`}>Comparison panel</label><select id={`${prefix}-side`} value={filters.side} aria-describedby={help} onChange={event => change("side", event)}><option value="">Both captured panels</option><option value="base">Recorded panel</option><option value="proposed">Proposed panel — unverified</option></select></div>
      <div><label htmlFor={`${prefix}-type`}>Statement type</label><select id={`${prefix}-type`} value={filters.statementType} aria-describedby={help} onChange={event => change("statementType", event)}><option value="">All statement types</option>{Object.entries(statementLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      <div><label htmlFor={`${prefix}-relation`}>Recorded reference role</label><select id={`${prefix}-relation`} value={filters.relation} aria-describedby={help} onChange={event => change("relation", event)}><option value="">All reference roles</option>{Object.entries(recordedReferenceRoleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      <button type="button" disabled={!active} onClick={() => {
        if (!current() || revision.current !== clearRevision) return;
        const clearedEpoch = ++inputEpoch.current; revision.current++;
        setFilters(old => alive.current && inputEpoch.current === clearedEpoch ? empty : old);
      }}>Clear reference finder</button>
    </div>
    <p id={status} role="status" aria-live="polite">{matches === null ? "Reference finder selection is invalid. Matching results are withheld." :
      active ? `${matches.length} of ${entries.length} captured reference occurrences match.` : `${entries.length} captured reference occurrences available. Enter search words or choose a filter.`}</p>
    <p>Filters may hide conflicting references in these locator results. Read the complete panels and source groups below. A recorded role, match or repeated use does not qualify wording, source independence or current rights.</p>
    {active && matches !== null && (matches.length ? <ol aria-label="Matching captured reference locations">{matches.map(entry => <li key={entry.anchor}>
      <a href={`#${entry.anchor}`}>{entry.side === "base" ? "Recorded" : "Proposed"} statement {entry.statementNumber}, reference {entry.referenceNumber}: <SearchMatchText text={entry.title} query={filters.query} /></a>
      <p>{statementLabels[entry.statementType]} · Data period: <SearchMatchText text={entry.periodLabel} query={filters.query} /> · {recordedReferenceRoleLabels[entry.relation]}</p>
      <p>Location: <SearchMatchText text={entry.locator} query={filters.query} /> · Source version: <code><SearchMatchText text={entry.sourceVersionId} query={filters.query} /></code></p>
    </li>)}</ol> : <p>No matching reference in these captured panels. This is not evidence that a source, action or conflict is absent elsewhere.</p>)}
  </section>;
}
