import type {RecordedHtmlInitialCaptureHistoryDecision} from "./server/recorded-html-initial-capture-history.ts";
import {HtmlPreparationReviewView} from "./html-preparation-review-view.tsx";
import {htmlInitialRecordedCaptureHref as href} from "./html-initial-recorded-capture-navigation.ts";
export function RecordedHtmlInitialCaptureView({decision}:{decision:RecordedHtmlInitialCaptureHistoryDecision}){
 if(decision.kind==="choice_required")return <section><h2>Choose a saved initial HTML candidate</h2><p>Metadata never selects its only or newest match. These generated choices perform no database read.</p>
  {decision.choices.matches.length?<ul>{decision.choices.matches.map(c=><li key={c.captureId}><a href={href(decision.preparationId,c.captureId)}>Inspect saved candidate <code>{c.captureId}</code></a></li>)}</ul>:<p>No matching candidate is present in this illustrative record.</p>}</section>;
 if(decision.kind!=="ok")return <section role="status"><h2>Selected initial HTML continuation unavailable</h2><p>The complete preparation, capture and separately supplied comparison could not be matched. No private candidate, source passage or context is displayed.</p></section>;
 const {stored,report}=decision.joined,p=stored.preparation,c=stored.capture;
 return <section aria-labelledby="html-initial-saved-heading"><h2 id="html-initial-saved-heading" tabIndex={-1}>Saved initial HTML candidate and provenance</h2>
  <p>Entirely generated illustrative records demonstrate the separate input checks. They are not actual database or reviewer observations. One unverified candidate is linked to its full HTML preparation.</p>
  <nav aria-label="Sections of this saved initial HTML example"><a href="#html-initial-empty-head">Empty head</a>{" · "}<a href="#html-initial-times">Separate times</a>{" · "}<a href="#html-initial-source">Original passages and preparation</a></nav>
  <section id="html-initial-empty-head" tabIndex={-1}><h3>Explicit empty current head</h3><p>The supplied record has an existing publication-head row with all three head fields null. No historical baseline is fabricated. This does not establish the present state or mean that the issue has never had a publication.</p>
   <dl><dt>Capture / preparation</dt><dd><code>{c.captureId}</code> / <code>{p.preparation.operation_id}</code></dd><dt>Held decision / issue</dt><dd><code>{c.decisionId}</code> / <code>{c.issueId}</code></dd></dl>
   <p>This single-claim technical preparation is not an accepted first publication or a whole-issue replacement. Source rights, factual support, conflict and translation review remain unqualified.</p></section>
  <section id="html-initial-times" tabIndex={-1}><h3>Separate illustrative observations</h3><dl>
   <dt>Preparation created</dt><dd><time dateTime={p.preparation.prepared_at}>{p.preparation.prepared_at}</time></dd><dt>Preparation stored</dt><dd><time dateTime={p.preparation.stored_at}>{p.preparation.stored_at}</time></dd>
   <dt>Preparation report</dt><dd><time dateTime={p.observedAt}>{p.observedAt}</time></dd><dt>Candidate captured</dt><dd><time dateTime={c.capturedAt}>{c.capturedAt}</time></dd><dt>Association stored</dt><dd><time dateTime={stored.storedAt}>{stored.storedAt}</time></dd>
   <dt>Metadata choice record</dt><dd><time dateTime={decision.lookupObservedAt}>{decision.lookupObservedAt}</time></dd><dt>Complete capture record</dt><dd><time dateTime={decision.captureObservedAt}>{decision.captureObservedAt}</time></dd><dt>Separately supplied comparison</dt><dd><time dateTime={report.observedAt}>{report.observedAt}</time></dd></dl>
   <p>Opening this example supplies no new observation and renews no historical record or work claim.</p></section>
  <section id="html-initial-source" tabIndex={-1}><h3>Complete original preparation and HTML passages</h3><p>The panel describes the earlier preparation stage; its unconnected-capture notice belongs to that stage.</p><HtmlPreparationReviewView raw={stored.reportJson} expected={decision.display.preparationExpected}/></section>
  <p><a href={href(decision.preparationId)}>Return to this preparation and its candidate choices</a></p><p><a href="#html-initial-saved-heading">Back to this saved initial example</a></p>
 </section>;
}
