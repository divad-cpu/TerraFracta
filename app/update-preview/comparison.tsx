"use client";

import { useId, useState } from "react";
import type { FictionalPublicationDraft } from "../../src/fictional-publication-draft";
import { compareFictionalObservations, exportFictionalComparison } from "../../src/fictional-observation-comparison";
import { compareRecordedInstants } from "../../src/recorded-instant-order.ts";
import { observeClientError } from "../../src/client-error-diagnostics.ts";

export function FictionalComparison({ baseline, candidate, isCurrent = () => true }: {
  baseline: FictionalPublicationDraft; candidate: FictionalPublicationDraft; isCurrent?: () => boolean;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const heading = useId();
  const ownsSelection = () => { try { return isCurrent(); } catch { return false; } };
  const comparison = compareFictionalObservations(baseline, candidate);
  if (comparison.kind === "held") return <section className="update-comparison"><h2>Comparison held</h2><p>The two drafts do not provide a consistent comparison of the same fictional observation.</p></section>;
  const sameSourceVersion = comparison.beforeSourceVersionId === comparison.afterSourceVersionId;
  const tiedVersionRetrieval = !sameSourceVersion && compareRecordedInstants(comparison.beforeRetrievedAt, comparison.afterRetrievedAt) === 0;
  return <section className="update-comparison" aria-labelledby={heading}>
    <div className="section-heading"><div><p className="eyebrow">{comparison.kind === "changed" ? "What changed in the source" : "Compare the recorded observations"}</p><h2 id={heading}>{comparison.kind === "changed" ? "Same period · revised observation" : "Same period · unchanged observation"}</h2></div><span className="tag tag--caution">Fictional comparison</span></div>
    <div className="update-comparison__values">
      <article><p className="eyebrow">{sameSourceVersion ? "First recorded draft" : tiedVersionRetrieval ? "First recorded source version" : "Earlier source version"}</p><strong>{comparison.beforeValue}%</strong><p>Period {comparison.period}</p><a href={comparison.beforeUrl}>{sameSourceVersion ? "First draft’s illustrative source" : tiedVersionRetrieval ? "First recorded illustrative source" : "Earlier illustrative source"}</a><p>Fixture retrieval: <time dateTime={comparison.beforeRetrievedAt}>{comparison.beforeRetrievedAt}</time></p>
        <details><summary>{sameSourceVersion ? "Recorded source version: first draft" : tiedVersionRetrieval ? "Recorded source version: first" : "Recorded source version: earlier"}</summary><dl><dt>Source version reference</dt><dd><code>{comparison.beforeSourceVersionId}</code></dd><dt>Content fingerprint</dt><dd><code>{comparison.beforeContentSha256}</code></dd></dl></details>
      </article>
      <article><p className="eyebrow">{sameSourceVersion ? "Second recorded draft" : tiedVersionRetrieval ? "Second recorded source version" : "New source version"}</p><strong>{comparison.afterValue}%</strong><p>Period {comparison.period}</p><a href={comparison.afterUrl}>{sameSourceVersion ? "Second draft’s illustrative source" : tiedVersionRetrieval ? "Second recorded illustrative source" : "New illustrative source"}</a><p>Fixture retrieval: <time dateTime={comparison.afterRetrievedAt}>{comparison.afterRetrievedAt}</time></p>
        <details><summary>{sameSourceVersion ? "Recorded source version: second draft" : tiedVersionRetrieval ? "Recorded source version: second" : "Recorded source version: new"}</summary><dl><dt>Source version reference</dt><dd><code>{comparison.afterSourceVersionId}</code></dd><dt>Content fingerprint</dt><dd><code>{comparison.afterContentSha256}</code></dd></dl></details>
      </article>
    </div>
    <p className="update-comparison__difference"><strong>{comparison.deltaPercentagePoints} percentage points</strong> · {comparison.kind === "changed" ? "Proposed change to this fictional fact" : "The observed value is unchanged"}</p>
    <p>{comparison.kind === "changed" ? "The source revised a value for the same period. This does not describe change between years or explain why a value changed." : "The checked value is the same in both drafts. This does not establish a change between periods or a causal result."}</p>
    {tiedVersionRetrieval && <p>The versions have the same recorded retrieval time. Their source-publication order is not established by this comparison.</p>}
    <p>Version references and fingerprints do not establish independent sources, live access or publication rights.</p>
    <details><summary>Comparison checks</summary><p>The period, geography, unit, data mapping and source location agree. {comparison.kind === "changed" ? "The new draft has a different source version and content fingerprint, with a later retrieval." : "The checked value is unchanged."}</p><p>Exact location: <code>{comparison.locator}</code></p></details>
    <button className="button button--quiet" type="button" onClick={() => {
      if (!ownsSelection()) return;
      let url: string | null = null, link: HTMLAnchorElement | null = null;
      try {
        const bytes = exportFictionalComparison(baseline, candidate);
        if (!ownsSelection()) return;
        link = document.createElement("a");
        if (!ownsSelection()) return;
        url = URL.createObjectURL(new Blob([bytes],{type:"application/json"}));
        link.href = url; link.download = "terrafracta-fictional-comparison.json";
        if (!ownsSelection()) return;
        document.body.append(link);
        if (!ownsSelection()) return;
        link.click();
        if (ownsSelection()) setMessage("Download requested. The file contains only this fictional comparison and its source references.");
      } catch { if (ownsSelection()) { observeClientError("update_export"); setMessage("The comparison could not be exported. Its displayed values are preserved."); } }
      finally {
        try { link?.remove(); } catch { /* Preserve the original export outcome. */ }
        if (url !== null) {
          const allocated = url;
          const revoke = () => { try { URL.revokeObjectURL(allocated); } catch { /* Best-effort cleanup, without recursive diagnostics. */ } };
          try { setTimeout(revoke, 1000); }
          catch { revoke(); }
        }
      }
    }}>Download fictional comparison</button>
    {message && <p role="status">{message}</p>}
    <p className="small-note">Both values are invented. This comparison proposes no change to a real page.</p>
  </section>;
}
