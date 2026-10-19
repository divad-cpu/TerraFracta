import type {RecordedPdfInitialCaptureHistoryDecision} from "./server/recorded-pdf-initial-capture-history.ts";
import {PdfInitialCandidateReviewView} from "./pdf-initial-candidate-review-view.tsx";
import {pdfInitialRecordedCaptureHref as href} from "./pdf-initial-recorded-capture-navigation.ts";
export function RecordedPdfInitialCaptureView({decision}:{decision:RecordedPdfInitialCaptureHistoryDecision}){
 if(decision.kind==="choice_required")return <section><h2>Choose a saved initial PDF candidate</h2><p>Metadata never selects its only or newest match. These illustrative choices perform no database read.</p>
 {decision.choices.matches.length?<ul>{decision.choices.matches.map(c=><li key={c.captureId}><a href={href(decision.preparationId,c.captureId)}>Inspect saved candidate <code>{c.captureId}</code></a></li>)}</ul>:<p>No matching candidate is present in this illustrative record.</p>}</section>;
 if(decision.kind!=="ok")return <section role="status"><h2>Selected initial PDF continuation unavailable</h2><p>The complete preparation and capture could not be matched. No partial candidate, source passage or context is displayed.</p></section>;
 return <section aria-labelledby="pdf-initial-saved-heading"><h2 id="pdf-initial-saved-heading" tabIndex={-1}>Saved initial PDF candidate and provenance</h2>
 <p>Saved illustrative records from an invented isolated local laboratory link one unverified candidate to its complete PDF preparation. These historical records establish no genuine source, present operational state or publication acceptance. This page supplies no current database or reviewer observation.</p>
 <section aria-labelledby="pdf-initial-times"><h3 id="pdf-initial-times">Separate historical observations</h3><dl>
 <dt>Metadata choice record</dt><dd><time dateTime={decision.lookupObservedAt}>{decision.lookupObservedAt}</time></dd>
 <dt>Later author readmission of complete receipt</dt><dd><time dateTime={decision.captureObservedAt}>{decision.captureObservedAt}</time></dd></dl>
 <p>The later capture observation is an explicitly supplied author readmission of the complete retained receipt, not a native query or selector timestamp. Opening this example renews no historical record or work claim. No present-head comparison is supplied.</p></section>
 <PdfInitialCandidateReviewView receipt={Buffer.from(decision.display.receiptBase64,"base64")} intentJson={decision.display.intentJson} expected={decision.display.expected} observedAt={decision.display.observedAt}/>
 <p><a href={href(decision.preparationId)}>Return to this preparation and its candidate choices</a></p></section>;
}
