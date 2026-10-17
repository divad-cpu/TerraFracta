import type {RecordedInitialCaptureHistoryDecision} from "./server/recorded-initial-capture-history.ts";
import {InitialCandidateCaptureView} from "./initial-candidate-capture-view.tsx";
function href(preparation:string,capture?:string){return `/editorial-preview/initial-capture-history?preparation=${encodeURIComponent(preparation)}${capture===undefined?"":`&capture=${encodeURIComponent(capture)}`}`;}
export function RecordedInitialCaptureHistoryView({decision}:{decision:RecordedInitialCaptureHistoryDecision}){
 if(decision.kind!=="ok"&&decision.kind!=="choice_required")return <section role="status"><h2>Initial continuation unavailable</h2><p>The selected preparation, metadata, complete initial candidate and separate comparison could not all be matched. All private candidate, context and source passages are withheld.</p></section>;
 const {choices,preparationId}=decision;
 return <section aria-labelledby="initial-history-heading"><h2 id="initial-history-heading" tabIndex={-1}>Saved initial candidates for this preparation</h2>
  <p>Entirely invented historical records. This metadata was observed through the fixed owner-only reader in an isolated local trial. Opening this page makes no database, source or model request and does not renew any observation.</p>
  <dl><dt>Explicit preparation</dt><dd><code>{preparationId}</code></dd><dt>Original metadata SQL observation</dt><dd><time dateTime={choices.observedAt}>{choices.observedAt}</time></dd></dl>
  {choices.matches.length===0?<p>No matching initial candidate was present in this confirmed historical preparation scope. This is not permission to recreate it or claim its present absence.</p>:<ol aria-label="Saved initial candidates for this explicitly selected preparation">{choices.matches.map(row=><li key={row.captureId}><dl><dt>Capture</dt><dd><code>{row.captureId}</code></dd><dt>Stored</dt><dd><time dateTime={row.storedAt}>{row.storedAt}</time></dd><dt>Independent intent fingerprint to match</dt><dd><code>{row.intentSha256}</code></dd></dl><a href={href(preparationId,row.captureId)} aria-current={decision.kind==="ok"&&decision.captureId===row.captureId?"page":undefined}>Inspect this explicitly selected initial candidate</a></li>)}</ol>}
  <p>A metadata identity cannot supply the full capture intent or authorize access. Even one matching candidate requires an explicit choice and the separately retained full intent, preparation and comparison.</p>
  {decision.kind==="choice_required"?<p>No initial candidate is selected. Choose a candidate before private preparation or source passages are displayed.</p>:<>
   <p><a href={href(preparationId)}>Return to this exact preparation and its saved candidate choices</a></p>
   <dl><dt>Original metadata after-read observation</dt><dd><time dateTime={decision.lookupObservedAt}>{decision.lookupObservedAt}</time></dd><dt>Separate original full-read observation</dt><dd><time dateTime={decision.captureObservedAt}>{decision.captureObservedAt}</time></dd></dl>
   <InitialCandidateCaptureView record={decision.display}/>
  </>}
  <p>No editorial action is available. Actual authenticated access, current source support, rights, translation, conflict and publication acceptance remain separate.</p>
 </section>;
}
