import type {RecordedPdfAppendedCaptureHistoryDecision} from "./server/recorded-pdf-appended-capture-history.ts";
import {PdfAppendedCaptureReviewView} from "./pdf-appended-capture-review-view.tsx";
import {pdfWholeRecordedCaptureHref as href} from "./pdf-whole-recorded-capture-navigation.ts";
export function RecordedPdfAppendedCaptureView({decision}:{decision:RecordedPdfAppendedCaptureHistoryDecision}){
 if(decision.kind==="choice_required")return <section><h2>Choose a saved complete PDF issue proposal</h2><p>Metadata never selects its only or newest match. These illustrative choices perform no database read.</p>
 {decision.choices.matches.length?<ul>{decision.choices.matches.map(c=><li key={c.captureId}><a href={href(decision.preparationId,c.captureId)}>Inspect saved candidate <code>{c.captureId}</code></a></li>)}</ul>:<p>No matching candidate is present in this illustrative record.</p>}</section>;
 if(decision.kind!=="ok")return <section role="status"><h2>Selected whole PDF continuation unavailable</h2><p>The complete preparation and capture could not be matched. No partial candidate, source passage or context is displayed.</p></section>;
 return <section aria-labelledby="pdf-whole-saved-heading"><h2 id="pdf-whole-saved-heading" tabIndex={-1}>Saved complete PDF issue proposal and provenance</h2>
 <p>Generated illustrative metadata is joined to a separately supplied invented complete six-part receipt. This is not a retained native lookup or a new database observation. The historical proposal includes its earlier publication basis and an unverified candidate; it establishes no genuine source, present operational state or publication acceptance.</p>
 <section aria-labelledby="pdf-whole-times"><h3 id="pdf-whole-times">Separate historical observations</h3><dl>
 <dt>Metadata choice record</dt><dd><time dateTime={decision.lookupObservedAt}>{decision.lookupObservedAt}</time></dd>
 <dt>Supplied historical complete receipt observation</dt><dd><time dateTime={decision.captureObservedAt}>{decision.captureObservedAt}</time></dd></dl>
 <p>The metadata timestamp is generated for this example and does not represent a native lookup. The complete receipt retains its separately supplied historical observation. Opening this example renews no historical record or work claim. No present-head comparison is supplied.</p></section>
 <PdfAppendedCaptureReviewView receipt={Buffer.from(decision.display.receiptBase64,"base64")} intentJson={decision.display.intentJson} expected={decision.display.expected} observedAt={decision.display.observedAt}/>
 <p><a href={href(decision.preparationId)}>Return to this preparation and its candidate choices</a></p></section>;
}
