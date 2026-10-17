import type { RecordedHtmlAppendedCaptureDecision } from "./server/recorded-html-appended-capture.ts";
import { htmlRecordedCaptureHref } from "./html-recorded-capture-navigation.ts";
import { HtmlAppendedCaptureView } from "./html-appended-capture-view.tsx";

export function RecordedHtmlAppendedCaptureView({decision}:{decision:RecordedHtmlAppendedCaptureDecision}){
 if(decision.kind==="choice_required")return <section aria-labelledby="html-capture-choice-heading">
  <h2 id="html-capture-choice-heading" tabIndex={-1}>Choose a saved HTML composition</h2>
  <p>The chosen preparation has {decision.choices.matches.length} recorded composition. A choice does not establish current source support, review or publication approval.</p>
  {decision.choices.matches.length?<ul>{decision.choices.matches.map(row=><li key={row.captureId}><a href={htmlRecordedCaptureHref(decision.preparationId,row.captureId)}>Open the composition stored <time dateTime={row.storedAt}>{row.storedAt}</time></a></li>)}</ul>:<p>No saved composition was recorded in this supplied lookup. No other preparation is used as a fallback.</p>}
  <p>Preparation and storage observations retain their original dates when opened.</p>
 </section>;
 if(decision.kind!=="ok")return <section role="status"><h2>Selected HTML continuation unavailable</h2><p>The chosen preparation, saved composition and separate recorded comparison could not be matched. Their private contents are withheld.</p></section>;
 return <section aria-label="Explicitly selected saved HTML composition">
  <p>This composition was chosen explicitly from the checked preparation record. The supplied records are invented; opening this view performs no fresh database read.</p>
  <p><a href={htmlRecordedCaptureHref(decision.preparationId)}>Return to this preparation’s composition choices</a></p>
  <HtmlAppendedCaptureView raw={Buffer.from(decision.display.rawReceiptJson,"utf8")} retainedIntentJson={decision.display.retainedIntentJson} observedAt={decision.observedAt} actualReport={JSON.parse(decision.display.actualComparisonJson)}/>
 </section>;
}
