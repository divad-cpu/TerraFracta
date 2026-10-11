"use client";

import { useEffect, useRef, useState } from "react";
import { emptyFictionalHistorySelection, fictionalHistoryPageHref, fictionalReceiptPageSchema, type FictionalReceiptPage, type FictionalHistorySelection } from "../../src/fictional-receipt-page";
import type { FictionalUpdateResult } from "../../src/fictional-update-result";
import { withLocalRequestDeadline } from "../../src/local-request-deadline";
import { discardLocalResponse, localResponseBytes, readLocalResponseJson } from "../../src/local-response-json.ts";
import { observeClientError } from "../../src/client-error-diagnostics.ts";

const exampleLabel = {
  standard: "Changed, held and unchanged",
  missing_source: "Missing source",
  invalid_citation: "Invalid source link",
  revised_value: "Revised value: 27.4% → 28.1%",
};
type HistoryVisit = object;

export function FictionalHistory({ onInspect, inspectionDisabled = false, onUseEarlier }: {
  onInspect: (result: FictionalUpdateResult) => void;
  inspectionDisabled?: boolean;
  onUseEarlier?: (result: FictionalUpdateResult) => void;
}) {
  const [recordedHistory, setHistory] = useState<FictionalReceiptPage | null>(null);
  const [filters, setFilters] = useState<FictionalHistorySelection>(emptyFictionalHistorySelection);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const visit = useRef<HistoryVisit | null>(null);
  const observation = useRef<FictionalReceiptPage | null>(null);
  const [owner, setOwner] = useState<HistoryVisit | null>(null);
  const admitted = owner !== null && visit.current === owner;
  const history = admitted && observation.current === recordedHistory ? recordedHistory : null;
  useEffect(() => {
    const current: HistoryVisit = {};
    visit.current = current; setOwner(current);
    observation.current = null; setHistory(null); setError(null);
    setBusy(controller.current !== null);
    return () => {
      if (visit.current !== current) return;
      visit.current = null; observation.current = null;
      // A retired visit cannot publish, but its physical read still owns the
      // shared slot until settlement. Recreating the effect is not a retry.
      controller.current?.abort();
    };
  }, []);

  function ownsObservation(page: FictionalReceiptPage) {
    return admitted && visit.current === owner && controller.current === null && observation.current === page;
  }

  async function refresh(selection: FictionalHistorySelection = filters, snapshot?: string) {
    if (!admitted || visit.current !== owner || controller.current !== null) return;
    const active = new AbortController();
    controller.current = active;
    // Retained row/page callbacks are denied before React rerenders the list.
    observation.current = null;
    setBusy(true);
    setError(null);
    setHistory(null);
    let deadlineElapsed = false, archiveChanged = false;
    try {
      const checked = await withLocalRequestDeadline(active.signal, 5_000, async (signal) => {
        const response = await fetch(fictionalHistoryPageHref(selection, snapshot), { method: "GET", cache: "no-store", signal });
        if (response.status === 409) {
          const failure = await readLocalResponseJson(response, signal, localResponseBytes.refusal);
          archiveChanged = failure !== null && typeof failure === "object" && "error" in failure && failure.error === "fictional_history_changed";
          throw new Error("History observation changed");
        }
        if (!response.ok) { discardLocalResponse(response); throw new Error("History unavailable"); }
        const page = fictionalReceiptPageSchema.parse(await readLocalResponseJson(response, signal, localResponseBytes.history));
        if (page.selection.page !== selection.page || page.selection.scenario !== selection.scenario || page.selection.trigger !== selection.trigger ||
            (snapshot !== undefined && (!page.stableSnapshot || page.snapshotToken !== snapshot))) throw new Error("History selection mismatch");
        return page;
      }, undefined, () => {
        deadlineElapsed = true;
        if (visit.current === owner && controller.current === active && !active.signal.aborted)
          setError("The response deadline elapsed. The original history read is still finishing; another cannot start yet. Previous entries are withheld.");
      });
      if (visit.current === owner && controller.current === active && !active.signal.aborted) {
        observation.current = checked; setHistory(checked);
      }
    } catch {
      if (visit.current === owner && controller.current === active && !active.signal.aborted) {
        if (!deadlineElapsed && !archiveChanged) observeClientError("update_history");
        setError(archiveChanged ? "The saved archive changed between pages. Load the filtered runs again to read a fresh first page." : "The local fictional history could not be read. Previous entries are withheld.");
      }
    } finally {
      if (controller.current === active) {
        controller.current = null;
        // Only availability can reach an admitted successor when a retired
        // read settles. Its result, errors and row controls stay withheld.
        if (visit.current !== null) setBusy(false);
      }
    }
  }

  return <section className="update-history" aria-labelledby="history-heading" aria-busy={busy}>
    <div className="section-heading"><div><p className="eyebrow">Saved on this machine</p><h2 id="history-heading">Saved fictional runs</h2></div><button className="button" type="button" onClick={() => void refresh({ ...filters, page: 1 })} disabled={!admitted || busy}>{busy ? "Reading…" : "Load filtered runs"}</button></div>
    <p>Rehearsal receipts survive a page reload and a server restart. Only invented results are stored; this history is not a live update ledger.</p>
    <form className="fictional-history-filters" onSubmit={event => { event.preventDefault(); void refresh({ ...filters, page: 1 }); }}>
      <label>Rehearsal example<select value={filters.scenario} disabled={!admitted || busy} onChange={event => { if (admitted && visit.current === owner && controller.current === null) setFilters({ ...filters, scenario: event.target.value as FictionalHistorySelection["scenario"], page: 1 }); }}><option value="">All examples</option>{Object.entries(exampleLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Trigger<select value={filters.trigger} disabled={!admitted || busy} onChange={event => { if (admitted && visit.current === owner && controller.current === null) setFilters({ ...filters, trigger: event.target.value as FictionalHistorySelection["trigger"], page: 1 }); }}><option value="">All triggers</option><option value="manual">Manual</option><option value="scheduled">Weekly rehearsal</option></select></label>
      <button className="button button--secondary" type="submit" disabled={!admitted || busy}>Apply history filters</button>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    {history && <>
      <p role="status">{history.totalReceipts + history.pendingReceipts} of {history.capacity} local receipt slots used. {history.matchingReceipts} readable runs match {history.selection.scenario ? exampleLabel[history.selection.scenario] : "all examples"} / {history.selection.trigger || "all triggers"}. Page {history.selection.page} of {history.pages}, {history.entries.length} entries shown. Saved receipts are never replaced or removed automatically.</p>
      {!history.stableSnapshot && <p className="form-error" role="status">The inventory changed or contains unrecognized entries. These verified entries are a partial observation; page navigation is withheld. Inspect the preserved archive and load it again.</p>}
      {history.unreadableReceipts > 0 && <p className="form-error" role="status">{history.unreadableReceipts} receipt(s) could not be verified and are withheld.</p>}
      {history.pendingReceipts > 0 && <p className="form-error" role="status">{history.pendingReceipts} incomplete writing attempt(s) are preserved locally and need attention.</p>}
      <ol className="update-history__entries">{history.entries.map((entry) => <li key={entry.execution.id}>
        <div><strong>{exampleLabel[entry.execution.scenario]}</strong><p><time dateTime={entry.execution.executedAt}>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "medium", timeZone: "Europe/Oslo" }).format(new Date(entry.execution.executedAt))}</time> Oslo · {entry.report.trigger === "scheduled" ? "weekly rehearsal" : "manual"}</p><span>{entry.report.items.length} checked · {entry.report.items.filter((item) => item.outcome === "held").length} held · zero published</span></div>
        <div><button className="button" type="button" disabled={inspectionDisabled || busy} onClick={() => { if (!inspectionDisabled && ownsObservation(history)) onInspect(entry); }}>Inspect saved run<span className="visually-hidden"> from {entry.execution.executedAt}</span></button>
          {onUseEarlier && <button className="button button--quiet" type="button" disabled={inspectionDisabled || busy} onClick={() => { if (!inspectionDisabled && ownsObservation(history)) onUseEarlier(entry); }}>Use as earlier run<span className="visually-hidden"> from {entry.execution.executedAt}</span></button>}
        </div>
      </li>)}</ol>
      {history.entries.length === 0 && <p>No readable run matches these filters in this observation. This does not establish that earlier or incomplete attempts are absent.</p>}
      <nav className="fictional-history-pages" aria-label="Saved fictional run pages">
        {history.selection.page > 1 && <button className="button button--quiet" type="button" disabled={busy || !history.stableSnapshot} onClick={() => { if (history.stableSnapshot && ownsObservation(history)) void refresh({ ...history.selection, page: history.selection.page - 1 }, history.snapshotToken); }}>Newer matching runs</button>}
        {history.selection.page < history.pages && <button className="button button--quiet" type="button" disabled={busy || !history.stableSnapshot} onClick={() => { if (history.stableSnapshot && ownsObservation(history)) void refresh({ ...history.selection, page: history.selection.page + 1 }, history.snapshotToken); }}>Older matching runs</button>}
      </nav>
    </>}
  </section>;
}
