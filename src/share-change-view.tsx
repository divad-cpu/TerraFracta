"use client";
import { useId, useState, type FormEvent } from "react";
import { compareShares } from "./share-change.ts";

export function ShareChangeExample() {
  const prefix = useId();
  const [before, setBefore] = useState(""), [after, setAfter] = useState("");
  const [comparison, setComparison] = useState<ReturnType<typeof compareShares> | null>(null);
  const invalid = comparison?.kind === "invalid";
  function compare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setComparison(compareShares(before, after));
  }
  function clear() { setBefore(""); setAfter(""); setComparison(null); }
  return <section aria-labelledby={`${prefix}-heading`}>
    <h3 id={`${prefix}-heading`}>Try a hypothetical share change</h3>
    <p>Enter two shares of the same total. This arithmetic example reads no dossier or source and cannot establish a policy effect. Your entries stay in this view.</p>
    <form className="issue-search__form" onSubmit={compare}>
      <div><label htmlFor={`${prefix}-before`}>Earlier share (%)</label><input id={`${prefix}-before`} type="text" inputMode="decimal" maxLength={12} value={before} aria-invalid={invalid} aria-describedby={`${prefix}-help`} onChange={event => { setBefore(event.target.value); setComparison(null); }} /></div>
      <div><label htmlFor={`${prefix}-after`}>Later share (%)</label><input id={`${prefix}-after`} type="text" inputMode="decimal" maxLength={12} value={after} aria-invalid={invalid} aria-describedby={`${prefix}-help`} onChange={event => { setAfter(event.target.value); setComparison(null); }} /></div>
      <button className="button button--secondary" type="submit">Compare these shares</button>
    </form>
    <p className="field-hint" id={`${prefix}-help`}>Use 0 to 100 with up to four decimal places. A decimal point or comma is accepted; omit the % sign.</p>
    <div className="hero__actions"><button className="button button--quiet" type="button" onClick={() => { setBefore("10"); setAfter("12"); setComparison(null); }}>Fill the 10% to 12% example</button><button className="button button--quiet" type="button" onClick={clear}>Clear share example</button></div>
    {invalid && <p role="alert" className="form-error">Check both shares. Use numbers from 0 to 100 with up to four decimal places.</p>}
    {comparison?.kind === "comparison" && <div role="status" aria-live="polite">
      <h4>Hypothetical calculation: {comparison.before}% → {comparison.after}%</h4>
      <dl className="source-date-guide"><div><dt>Percentage-point change</dt><dd>{comparison.percentagePoints} percentage points</dd></div><div><dt>Relative percentage change</dt><dd>{comparison.relativePercent === null ? "Not defined: the earlier share is zero." : `${comparison.relativePercent}% relative to the earlier share (rounded to four decimal places).`}</dd></div></dl>
      <p>{comparison.direction === "unchanged" ? "The entered shares are equal." : `The entered share shows ${comparison.direction === "increase" ? "an increase" : "a decrease"}.`} Comparability and causal evidence must be checked separately.</p>
    </div>}
  </section>;
}
