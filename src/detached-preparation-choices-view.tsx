import { detachedPreparationChoices,selectedDetachedPreparation } from "./server/detached-preparation-choices.ts";
import { DetachedPreparationView } from "./detached-preparation-view.tsx";

export function DetachedPreparationChoicesView({raw,expected,selected,selectedRaw,selectedExpected}: {
  raw:unknown;expected:unknown;selected?:unknown;selectedRaw?:unknown;selectedExpected?:unknown;
}) {
  const choices=detachedPreparationChoices(raw,expected);
  if(choices===null)return <section><h2>Historical choices unavailable</h2><p>No partial metadata or candidate is displayed.</p></section>;
  const selection=selected===undefined?undefined:selectedDetachedPreparation(raw,expected,selected,selectedRaw,selectedExpected);
  return <section aria-labelledby="preparation-choices-heading"><h2 id="preparation-choices-heading">Choose a recorded historical preparation</h2>
    <p>Entirely invented, fixed local records. This page makes no database, source or model request. No preparation is selected automatically, even when only one is listed.</p>
    <p>Metadata was observed at <time dateTime={choices.inventoryObservedAt}>{choices.inventoryObservedAt}</time>. These records do not establish current source health, an actual held decision or publication eligibility.</p>
    {choices.candidates.length===0?<p>No matching historical metadata was observed in the supplied scope. This does not authorize a new extraction or prove absence of source evidence.</p>:<ol>
      {choices.candidates.map((row,index)=><li key={row.operation_id}><article><h3>Recorded preparation {index+1}</h3>
        <dl><dt>Operation</dt><dd><code style={{overflowWrap:"anywhere"}}>{row.operation_id}</code></dd><dt>Prepared / stored</dt><dd><time dateTime={row.prepared_at}>{row.prepared_at}</time> / <time dateTime={row.stored_at}>{row.stored_at}</time></dd>
          <dt>Metadata intent fingerprint</dt><dd><code style={{overflowWrap:"anywhere"}}>{row.intentSha256}</code></dd></dl>
        <p><a href={`/editorial-preview/preparation-history?preparation=${row.operation_id}`} aria-current={selected===row.operation_id?"page":undefined}>Inspect recorded preparation {index+1}</a></p>
      </article></li>)}
    </ol>}
    <p>A choice must also match the separately retained pre-write intent and complete recorded report. Metadata alone is insufficient. Ordering is by historical storage time, without a newest-item default.</p>
    {selection===undefined?<p>Choose one record explicitly to inspect its private preparation and source passages.</p>:selection===null?<section><h3>Selected preparation unavailable</h3><p>No partial selected candidate, context or evidence is displayed.</p></section>:<>
      <p>The selected report is recorded evidence from <time dateTime={selection.report.observedAt}>{selection.report.observedAt}</time>. Opening this page does not perform a fresh storage read.</p>
      <DetachedPreparationView raw={selectedRaw} expected={selectedExpected} />
    </>}
  </section>;
}
