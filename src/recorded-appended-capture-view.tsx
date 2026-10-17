import type { RecordedAppendedCaptureDecision } from "./server/recorded-appended-capture.ts";
import { AppendedCaptureView } from "./appended-capture-view.tsx";
import { recordedCaptureHref } from "./recorded-capture-navigation.ts";

// Render only the all-or-nothing result from the fixed-record resolver. Source
// and passage details remain inside the existing full comparison admission.
export function RecordedAppendedCaptureView({decision}:{decision:RecordedAppendedCaptureDecision}){
 if(decision.kind!=="ok"&&decision.kind!=="choice_required")return <section role="status"><h2>Selected continuation unavailable</h2>
  <p>The selected preparation, saved composition and separate comparison could not all be matched. No partial proposal, baseline, context or source passage is displayed.</p></section>;
 const {choices,preparationId}=decision;
 return <section aria-labelledby="recorded-capture-heading"><h2 id="recorded-capture-heading" tabIndex={-1}>Recorded composition choices</h2>
  <p>Fixed invented records. The lookup metadata in this example was constructed for navigation; it is not a new database observation. Opening this page makes no database, source or model request.</p>
  <p>Selected preparation: <code>{preparationId}</code>. Metadata carries the original observation <time dateTime={choices.observedAt}>{choices.observedAt}</time>; opening this page does not renew it.</p>
  {choices.matches.length===0?<p>No matching composition appears in this supplied historical scope. This does not authorize another extraction, a retry or a new capture.</p>:<ol aria-label="Saved compositions for the explicitly selected preparation">
   {choices.matches.map((row,index)=><li key={row.captureId}><h3>Recorded composition {index+1}</h3><dl><dt>Capture</dt><dd><code>{row.captureId}</code></dd>
    <dt>Stored</dt><dd><time dateTime={row.storedAt}>{row.storedAt}</time></dd><dt>Metadata intent fingerprint</dt><dd><code>{row.intentSha256}</code></dd></dl>
    <p><a href={recordedCaptureHref(preparationId,row.captureId)} aria-current={decision.kind==="ok"&&decision.captureId===row.captureId?"page":undefined}>Inspect recorded composition {index+1}</a></p></li>)}
  </ol>}
  <p>A listed identity is insufficient to open the full composition. Its separately retained pre-write intent, all seven parts, selected preparation and separate recorded comparison must also match. No record is selected automatically.</p>
  {decision.kind==="choice_required"?<p>Choose a composition explicitly to inspect its saved proposal and source passages.</p>:<>
   <p><a href={recordedCaptureHref(preparationId)}>Return to this exact preparation and its composition choices</a></p>
   <AppendedCaptureView raw={Buffer.from(decision.display.rawReceiptJson,"utf8")} retainedIntentJson={decision.display.retainedIntentJson} observedAt={decision.observedAt} actualReport={JSON.parse(decision.display.actualComparisonJson)}/>
  </>}
  <p>No editorial action is available. Current source, head, work, rights, authentication, recovery and publication checks remain separate.</p>
 </section>;
}
