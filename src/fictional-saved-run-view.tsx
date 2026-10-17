"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { fictionalUpdateResultSchema, type FictionalUpdateResult } from "./fictional-update-result.ts";
import { exportFictionalSavedRun } from "./fictional-saved-run-export.ts";
import { FictionalRunReview } from "./fictional-run-review.tsx";
import { FictionalCandidate } from "../app/update-preview/candidate";
import { observeClientError } from "./client-error-diagnostics.ts";

export function FictionalSavedRunView({ input, isCurrent = () => true }: {
  input: unknown; isCurrent?: () => boolean;
}) {
  const mounted = useRef(false), heading = useId();
  const [notice, setNotice] = useState<{ generation: number; text: string } | null>(null);
  // Validate the entire selected result, including the report-item-to-draft
  // binding, before any draft or export becomes available. Untrusted getters
  // can throw independently of a schema refusal; keep both failures opaque.
  let result: FictionalUpdateResult | null;
  try {
    const checked = fictionalUpdateResultSchema.safeParse(input);
    result = checked.success ? checked.data : null;
  } catch { result = null; }
  const identity = result ? JSON.stringify(result) : null;
  const selection = useRef({ identity, generation: 0 });
  if (selection.current.identity !== identity)
    selection.current = { identity, generation: selection.current.generation + 1 };
  const generation = selection.current.generation;
  const ownsSelection = () => {
    try { return mounted.current && identity !== null && selection.current.identity === identity &&
      selection.current.generation === generation && isCurrent(); }
    catch { return false; }
  };
  useLayoutEffect(() => () => {
    mounted.current = false; selection.current.generation++;
  }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; selection.current.generation++; }; }, []);

  function download() {
    if (!result || !ownsSelection()) return;
    let url: string | null = null, link: HTMLAnchorElement | null = null;
    try {
      const bytes = exportFictionalSavedRun(result);
      if (!ownsSelection()) return;
      link = document.createElement("a");
      if (!ownsSelection()) return;
      url = URL.createObjectURL(new Blob([bytes], { type: "application/json" }));
      link.href = url; link.download = "terrafracta-fictional-saved-run.json";
      if (!ownsSelection()) return;
      document.body.append(link);
      if (!ownsSelection()) return;
      link.click();
      if (ownsSelection()) setNotice({ generation,
        text: "Download requested. The private file contains this checked fictional run, its source references and held decisions. It authorizes no actions." });
    } catch {
      if (ownsSelection()) {
        // Fixed action code only: no exception, filename, body or free-form
        // operation detail enters the diagnostic archive.
        observeClientError("saved_run_export");
        setNotice({ generation, text: "The saved run could not be exported. Its displayed draft and decisions are preserved." });
      }
    } finally {
      try { link?.remove(); } catch { /* Preserve the original download outcome. */ }
      if (url !== null) try { URL.revokeObjectURL(url); } catch { /* No retry or recursive diagnostic. */ }
    }
  }

  if (!result) return <section className="info-band" role="status"><h2>Saved rehearsal unavailable</h2>
    <p>The selected result could not be checked. Its draft, comparison and export are withheld.</p></section>;
  // The closed result already binds this one draft to its exact report item.
  // Instance-local fragments use its original ordinal, never a raw item key.
  const draftIndex = result.report.items.findIndex(item => item.itemKey === result.report.fictionalCandidate?.itemKey);
  const draftId = `${heading}-draft`, originId = `${heading}-item-${draftIndex}`;
  return <>
    <FictionalRunReview input={result} draftNavigation={draftIndex >= 0 ? { draftId, originId } : undefined} />
    <section className="info-band" aria-labelledby={heading}>
      <h3 id={heading}>Keep the selected historical result</h3>
      <p>This download preserves one checked saved rehearsal, including unchanged and held items. It is private invented evidence, not a current archive or a publication.</p>
      <button className="button button--quiet" type="button" onClick={download}>Download saved run</button>
      {notice?.generation === generation && <p role="status">{notice.text}</p>}
    </section>
    <aside className="info-band"><h3>Current publication unavailable</h3>
      <p>This saved rehearsal supplies an unpublished page draft only. No current public edition is connected here. Earlier drafts and their comparisons remain historical examples.</p></aside>
    {result.report.fictionalCandidate ? <div id={draftId}>
      <FictionalCandidate candidate={result.report.fictionalCandidate} />
      <p><a href={`#${originId}`}>Return to checked item {draftIndex + 1}</a></p>
    </div>
      : <section className="info-band" role="status"><h3>No checked page draft</h3>
        <p>This saved result does not contain a source-bound page draft. Its holds and incomplete source coverage remain available above.</p></section>}
  </>;
}
