"use client";

import { observeClientError } from "../../src/client-error-diagnostics.ts";

import { useId, useState } from "react";
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
  const id = (part: string) => `${prefix}-${part}`;
  const [kind, setKind] = useState<CorrectionKind>("incorrect_statement");
  const [detail, setDetail] = useState("");
  const [source, setSource] = useState("");
  const [claimId, setClaimId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [preparedRequest, setPreparedRequest] = useState<CorrectionRequest | null>(null);
  const [reviewUnavailable, setReviewUnavailable] = useState(false);
  const fields = correctionDraftFieldsSchema.safeParse({ kind, details: detail, sourceUrl: source });
  const sourceValid = correctionDraftFieldsSchema.shape.sourceUrl.safeParse(source).success;
  const detailsValid = correctionDraftFieldsSchema.shape.details.safeParse(detail).success;
  const pageTitle = context?.issue.title ?? "Norway / Housing costs";

  function reset() {
    setKind("incorrect_statement"); setDetail(""); setSource(""); setClaimId(null); setPreview(null); setPreparedRequest(null); setReviewUnavailable(false);
  }
  function review() {
    if (!fields.success) return;
    setReviewUnavailable(false);
    const connected = context ? context.edition === null ? previewCurrentIssueCorrection(context, fields.data, claimId) : previewConnectedCorrection(context, fields.data, claimId) : null;
    if (context && !connected) { setPreview(null); setReviewUnavailable(true); return; }
    if (context && connected) {
      // Retain one private identity for the same normalized unsent intent.
      // This state never leaves the editor; no fetch or persistence occurs.
      try {
        const prepared = prepareCorrectionRequest({ kind: "issue", issue: context.issue },
          { target: connected.draft.target, fields: connected.draft.fields }, () => crypto.randomUUID(), preparedRequest);
        if (prepared.kind !== "prepared") { setPreview(null); setReviewUnavailable(true); return; }
        setPreparedRequest(prepared.request);
      } catch { observeClientError("correction_prepare"); setPreview(null); setReviewUnavailable(true); return; }
    }
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
          <select id={id("claim")} value={claimId ?? ""} onChange={event => { setClaimId(event.target.value || null); setDetail(""); setSource(""); setPreview(null); setPreparedRequest(null); setReviewUnavailable(false); }} aria-describedby={id("target-guidance")}>
            <option value="">Entire page</option>
            {context.issue.claims.map(claim => <option key={claim.id} value={claim.id}>{claim.assertion}</option>)}
          </select>
          <p className="field-hint" id={id("target-guidance")}>Only statements visible in this exact edition are selectable. Changing the target clears the explanation and source.</p>
        </>}
        <label htmlFor={id("kind")}>What needs attention?</label>
        <select id={id("kind")} value={kind} onChange={event => { setKind(event.target.value as CorrectionKind); setPreview(null); setReviewUnavailable(false); }}>
          {Object.entries(correctionKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <label htmlFor={id("detail")}>Explanation <span>(10–1000 characters)</span></label>
        <textarea id={id("detail")} value={detail} maxLength={1000} rows={7} onChange={event => { setDetail(event.target.value); setPreview(null); setReviewUnavailable(false); }} placeholder="Sample: This sentence could clarify the time period..." aria-invalid={detail.length > 0 && !detailsValid} aria-describedby={id("detail-guidance")} />
        <p className="field-hint" id={id("detail-guidance")}>{detail.length} / 1000 characters. {detail.length > 0 && !detailsValid ? "Enter 10–1000 characters of sample text without unsupported control characters. " : ""}</p>
        <label htmlFor={id("source")}>Optional source URL <span>(HTTPS only)</span></label>
        <input id={id("source")} type="url" maxLength={2048} value={source} onChange={event => { setSource(event.target.value); setPreview(null); setReviewUnavailable(false); }} placeholder="https://example.org/sample" aria-invalid={!sourceValid} aria-describedby={id("source-guidance")} />
        <p className="field-hint" id={id("source-guidance")}>{sourceValid ? "A source is optional. It appears as text and will not be opened." : "Enter a complete HTTPS URL without whitespace, a username or password."}</p>
        <div className="correction-actions">
          <button type="button" disabled={!fields.success} onClick={review}>Review draft</button>
          <button type="button" className="button--quiet" onClick={reset}>Clear draft</button>
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
            <div><dt>Affected wording</dt><dd>{preview.connected.draft.claimAssertion ?? "Entire page"}</dd></div>
          </>}
          <div><dt>Type</dt><dd>{correctionKindLabels[preview.fields.kind]}</dd></div>
          <div><dt>Explanation</dt><dd className="correction-preview__detail">{preview.fields.details}</dd></div>
          <div><dt>Source URL</dt><dd className="correction-preview__detail">{preview.fields.sourceUrl || "None provided"}</dd></div>
        </dl>
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
