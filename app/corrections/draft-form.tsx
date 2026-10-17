"use client";

import { statementLabels } from "../../src/issue-display-labels.ts";

import { observeClientError } from "../../src/client-error-diagnostics.ts";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { correctionDraftFieldsSchema, correctionKindLabels, type CorrectionKind, type CorrectionDraftFields } from "../../src/correction-target";
import { connectedCorrectionContext, previewConnectedCorrection, type ConnectedCorrectionContext } from "../../src/connected-correction-draft";
import { prepareCorrectionRequest, type CorrectionRequest } from "../../src/correction-request";
import { sampleSections, type SampleSection } from "../../src/visitor-catalog.ts";
import { currentIssueCorrectionContext, previewCurrentIssueCorrection, type CurrentIssueCorrectionContext } from "../../src/current-issue-correction-draft.ts";

type DraftContext = ConnectedCorrectionContext | CurrentIssueCorrectionContext;
type Preview = { fields: CorrectionDraftFields; connected: ReturnType<typeof previewConnectedCorrection> | ReturnType<typeof previewCurrentIssueCorrection> };

// The original standalone exercise remains illustrative. A connected editor
// mounts only for a checked invented active edition, with an exact reset key.
export function CorrectionDraft({ connectedSnapshot, sampleSection = null }: { connectedSnapshot?: unknown; sampleSection?: SampleSection | null } = {}) {
  if (connectedSnapshot === undefined) return <CorrectionEditor context={null} sampleSection={sampleSection} key={`sample-${sampleSection ?? "page"}`} />;
  const context = connectedCorrectionContext(connectedSnapshot);
  if (!context) return <section className="info-band" role="status"><h2>Correction draft unavailable</h2><p>A checked visible edition is required. No draft is sent or saved.</p></section>;
  return <CorrectionEditor context={context} key={context.key} />;
}

export function CurrentIssueCorrectionDraft({ issue }: { issue: unknown }) {
  const context = currentIssueCorrectionContext(issue);
  if (!context) return <section className="info-band" role="status"><h2>Correction draft unavailable</h2><p>A checked visible issue is required. No draft is sent or saved.</p></section>;
  return <CorrectionEditor context={context} key={context.key} />;
}

function CorrectionEditor({ context, sampleSection = null }: { context: DraftContext | null; sampleSection?: SampleSection | null }) {
  const prefix = useId();
  const mounted = useRef(false), actionRevision = useRef(0), inputGeneration = useRef(0), admissionGeneration = useRef(0);
  const revision = actionRevision.current, generation = inputGeneration.current;
  // Retained render actions cannot restore retired text/targets or consume a
  // fresh private identity after edit, clear, another review or unmount.
  // Retire during the committed layout phase, before deferred passive cleanup.
  useLayoutEffect(() => () => { mounted.current = false; actionRevision.current++; admissionGeneration.current++; }, []);
  useEffect(() => {
    mounted.current = true;
    setAdmittedGeneration(++admissionGeneration.current);
    return () => { mounted.current = false; actionRevision.current++; admissionGeneration.current++; };
  }, []);
  const ownsAction = () => ownsView() && actionRevision.current === revision;
  function edit(change: () => void, resetsTarget = false) {
    if (!ownsView() || inputGeneration.current !== generation) return;
    actionRevision.current++;
    if (resetsTarget) inputGeneration.current++;
    change(); setPreview(null); setReviewUnavailable(false);
  }
  const id = (part: string) => `${prefix}-${part}`;
  const [kind, setKind] = useState<CorrectionKind>("incorrect_statement");
  const [detail, setDetail] = useState("");
  const [source, setSource] = useState("");
  const [claimId, setClaimId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [preparedRequest, setPreparedRequest] = useState<CorrectionRequest | null>(null);
  const [reviewUnavailable, setReviewUnavailable] = useState(false);
  const [admittedGeneration, setAdmittedGeneration] = useState<number | null>(null);
  const representedAdmission = admissionGeneration.current;
  const admittedView = mounted.current && admittedGeneration === representedAdmission;
  const ownsView = () => admittedView && mounted.current && admissionGeneration.current === representedAdmission;
  const fields = correctionDraftFieldsSchema.safeParse({ kind, details: detail, sourceUrl: source });
  const sourceValid = correctionDraftFieldsSchema.shape.sourceUrl.safeParse(source).success;
  const detailsValid = correctionDraftFieldsSchema.shape.details.safeParse(detail).success;
  const detailCharacters = Array.from(detail.trim()).length;
  const pageTitle = context?.issue.title ?? "Norway / Housing costs";

  const selectedStatement = context && preview?.connected?.draft.target.claimId
    ? context.issue.claims.findIndex(claim => claim.id === preview.connected?.draft.target.claimId) : -1;
  const reviewedClaim = context && selectedStatement >= 0 ? context.issue.claims[selectedStatement] : null;

  function reset() {
    if (!ownsAction()) return;
    actionRevision.current++; inputGeneration.current++;
    setKind("incorrect_statement"); setDetail(""); setSource(""); setClaimId(null); setPreview(null); setPreparedRequest(null); setReviewUnavailable(false);
  }
  function review() {
    if (!ownsAction() || !fields.success) return;
    const reviewRevision = ++actionRevision.current;
    const ownsReview = () => ownsView() && actionRevision.current === reviewRevision && inputGeneration.current === generation;
    setReviewUnavailable(false);
    const connected = context ? context.edition === null ? previewCurrentIssueCorrection(context, fields.data, claimId) : previewConnectedCorrection(context, fields.data, claimId) : null;
    if (context && !connected) { setPreview(null); setReviewUnavailable(true); return; }
    if (context && connected) {
      // Retain one private identity for the same normalized unsent intent.
      // This state never leaves the editor; no fetch or persistence occurs.
      try {
        const prepared = prepareCorrectionRequest({ kind: "issue", issue: context.issue },
          { target: connected.draft.target, fields: connected.draft.fields }, () => crypto.randomUUID(), preparedRequest);
        if (!ownsReview()) return;
        if (prepared.kind !== "prepared") { setPreview(null); setReviewUnavailable(true); return; }
        setPreparedRequest(prepared.request);
      } catch { if (!ownsReview()) return; observeClientError("correction_prepare"); setPreview(null); setReviewUnavailable(true); return; }
    }
    if (!ownsReview()) return;
    setPreview({ fields: fields.data, connected });
  }

  return <section className="correction-workspace" aria-labelledby={id("heading")}>
    <div>
      <p className="eyebrow">01 / Describe the sample issue</p>
      <h2 id={id("heading")}>Draft details</h2>
      <p className="small-note">Page reference: {pageTitle} · {context ? context.edition === null ? `current reader publication revision ${context.issue.revision}` : `fictional local edition ${context.edition.generation}, publication revision ${context.issue.revision}` : "illustrative page"}</p>
      {!context && sampleSection && <p className="small-note">Affected section: {sampleSections[sampleSection]} · illustrative page only</p>}
      <p className="small-note">Use sample text only. Draft text is not submitted or stored.</p>
      <div className="correction-fields">
        {context && <>
          <label htmlFor={id("claim")}>Affected part of this edition</label>
          <select id={id("claim")} value={claimId ?? ""} onChange={event => edit(() => { setClaimId(event.target.value || null); setDetail(""); setSource(""); setPreparedRequest(null); }, true)} aria-describedby={id("target-guidance")}>
            <option value="">Entire page</option>
            {context.issue.claims.map((claim, index) => <option key={claim.id} value={claim.id}>Statement {index + 1} · {statementLabels[claim.type]} · {claim.periodLabel} · {claim.assertion}</option>)}
          </select>
          <p className="field-hint" id={id("target-guidance")}>Only statements visible in this exact edition are selectable. Numbers follow this edition's statement order. Changing the target clears the explanation and source.</p>
        </>}
        <label htmlFor={id("kind")}>What needs attention?</label>
        <select id={id("kind")} value={kind} onChange={event => edit(() => setKind(event.target.value as CorrectionKind))}>
          {Object.entries(correctionKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <label htmlFor={id("detail")}>Explanation <span>(10–1000 characters)</span></label>
        {/* Native input capacity is in UTF-16 units; the existing schema's
            1,000-character limit counts Unicode code points after trimming. */}
        <textarea id={id("detail")} value={detail} maxLength={2 * 1000} rows={7} onChange={event => edit(() => setDetail(event.target.value))} placeholder="Sample: This sentence could clarify the time period..." aria-invalid={detail.length > 0 && !detailsValid} aria-describedby={id("detail-guidance")} />
        <p className="field-hint" id={id("detail-guidance")}>{detailCharacters} / 1000 characters in the reviewed explanation. {detail.length > 0 && !detailsValid ? "Enter 10–1000 characters of sample text without unsupported control characters. " : ""}</p>
        <label htmlFor={id("source")}>Optional source URL <span>(HTTPS only)</span></label>
        <input id={id("source")} type="url" maxLength={2048} value={source} onChange={event => edit(() => setSource(event.target.value))} placeholder="https://example.org/sample" aria-invalid={!sourceValid} aria-describedby={id("source-guidance")} />
        <p className="field-hint" id={id("source-guidance")}>{sourceValid ? "A source is optional. It appears as text and will not be opened." : "Enter a complete HTTPS URL without whitespace, a username or password."}</p>
        <div className="correction-actions">
          <button type="button" disabled={!admittedView || !fields.success} onClick={review}>Review draft</button>
          <button type="button" className="button--quiet" disabled={!admittedView} onClick={reset}>Clear draft</button>
        </div>
        {reviewUnavailable && <p className="form-error" role="alert">The draft could not be prepared. Your entered text is still here. No draft was sent or saved; edit the sample or try reviewing it again.</p>}
      </div>
    </div>
    <div className="correction-preview" aria-live="polite">
      <p className="eyebrow">02 / Local preview</p>
      <h2>What you wrote</h2>
      {preview ? <div className="correction-preview__card">
        <p className="eyebrow">Preview only · never submitted</p>
        <dl>
          <div><dt>Page</dt><dd>{pageTitle}</dd></div>
          {!context && sampleSection && <div><dt>Affected section</dt><dd>{sampleSections[sampleSection]}</dd></div>}
          {preview.connected && <>
            <div><dt>Edition</dt><dd>{preview.connected.edition !== null && <>Local edition {preview.connected.edition.generation} · </>}Publication revision {preview.connected.draft.target.revision}</dd></div>
            {reviewedClaim && <div><dt>Statement reference</dt><dd>Statement {selectedStatement + 1} · {statementLabels[reviewedClaim.type]} · {reviewedClaim.periodLabel}</dd></div>}
            <div><dt>Affected wording</dt><dd>{preview.connected.draft.claimAssertion ?? "Entire page"}</dd></div>
          </>}
          <div><dt>Type</dt><dd>{correctionKindLabels[preview.fields.kind]}</dd></div>
          <div><dt>Explanation</dt><dd className="correction-preview__detail">{preview.fields.details}</dd></div>
          <div><dt>Source URL</dt><dd className="correction-preview__detail">{preview.fields.sourceUrl || "None provided"}</dd></div>
        </dl>
        {reviewedClaim && <p><a href={`#claim-${reviewedClaim.id}`}>Inspect the affected statement and its references</a></p>}
        {preview.connected && <details><summary>Exact edition references</summary><dl>
          <div><dt>Issue</dt><dd>{preview.connected.draft.target.issueId}</dd></div>
          <div><dt>Publication</dt><dd>{preview.connected.draft.target.publicationId}</dd></div>
          <div><dt>Claim</dt><dd>{preview.connected.draft.target.claimId ?? "Page scope"}</dd></div>
          {preview.connected.edition !== null && <div><dt>Saved edition</dt><dd><time dateTime={preview.connected.edition.observedAt}>{preview.connected.edition.observedAt}</time></dd></div>}
        </dl></details>}
        <p className="correction-preview__status">This draft exists only in memory. No message was sent and no record was created.</p>
      </div> : <p className="small-note">{reviewUnavailable ? "No reviewed preview is available for this draft." : "Add a sample explanation, then choose “Review draft”. Nothing will be sent."}</p>}
    </div>
  </section>;
}
