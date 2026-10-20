"use client";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { matchingSourceLanguageLocations, type SourceLanguageLocations } from "./recorded-source-language-locations.ts";

// A local locator over the checked comparison. Complete receipts and their
// existing translation wording remain visible outside this component.
export function RecordedSourceLanguageFinder({ locations, comparisonKey }: { locations: SourceLanguageLocations; comparisonKey: string }) {
  const prefix = useId(), identity = JSON.stringify([comparisonKey, locations]);
  const latest = useRef(identity), visit = useRef<object | null>(null), revision = useRef(0);
  const [owner, setOwner] = useState<object | null>(null);
  const [filter, setFilter] = useState<{ identity: string; selection: string; revision: number } | null>(null);
  if (latest.current !== identity) { latest.current = identity; visit.current = null; }
  const admitted = owner !== null && visit.current === owner && latest.current === identity;
  const current = () => admitted && visit.current === owner && latest.current === identity;
  useLayoutEffect(() => {
    const token = {}; visit.current = token; revision.current++;
    setFilter({ identity, selection: "all", revision: revision.current }); setOwner(token);
    return () => { if (visit.current === token) { visit.current = null; revision.current++; } };
  }, [identity]);
  const selection = admitted && filter?.identity === identity ? filter.selection : "all";
  const matches = admitted && filter?.revision !== revision.current ? null : matchingSourceLanguageLocations(locations, selection);
  function change(event: { readonly currentTarget: HTMLSelectElement }) {
    if (!current()) return;
    const intent = ++revision.current, owns = () => current() && revision.current === intent;
    try {
      const target = event.currentTarget; if (!owns()) return;
      const value = target.value; if (!owns()) return;
      setFilter(old => owns() ? { identity, selection: value, revision: intent } : old);
    } catch {
      if (owns()) setFilter(old => owns() ? { identity, selection: "invalid", revision: intent } : old);
    }
  }
  return <section aria-labelledby={`${prefix}-heading`}><h3 id={`${prefix}-heading`}>Find captured source receipts by recorded language code</h3>
    <p id={`${prefix}-help`}>These are historical receipt codes, not detected or verified original languages. A missing code is unknown. Equal or different codes establish no translation requirement, translation quality, source support, current language or independent confirmation. The complete receipts and original translation status remain below.</p>
    <label htmlFor={`${prefix}-language`}>Recorded source receipt language</label>
    <select id={`${prefix}-language`} value={selection} disabled={!admitted} aria-describedby={`${prefix}-help ${prefix}-status`} aria-invalid={matches === null || undefined} onChange={change}>
      <option value="all">All captured source receipts</option><option value="missing">Language code not recorded</option>
      {locations.codes.map(code => <option key={code} value={`code:${code}`}>Recorded code: {code}</option>)}
    </select>
    <p id={`${prefix}-status`} role="status" aria-live="polite">{matches === null ? "Receipt language selection is invalid or unavailable. Matching locations are withheld." : `${matches.length} of ${locations.entries.length} captured source-version receipts match.`} Counts describe recorded versions, not independent sources or review readiness.</p>
    {matches !== null && (matches.length ? <ol aria-label="Matching source receipt locations">{matches.map(entry => <li key={entry.receiptNumber}>
      <a href={entry.receiptHref}>Receipt {entry.receiptNumber}: <code>{entry.sourceVersionId}</code></a>{" · "}<bdi>{entry.languageCode ?? "Language code not recorded"}</bdi>{" · "}<a href={entry.usesHref}>Inspect recorded uses in the comparison</a>
    </li>)}</ol> : <p>No captured receipt matches this choice. This does not establish that sources or languages are absent elsewhere.</p>)}
  </section>;
}
