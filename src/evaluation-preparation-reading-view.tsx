import { evaluationPreparationReading } from "./evaluation-preparation-reading.ts";
import { PreparationReadingView } from "./preparation-reading-view.tsx";

// Caller supplies one unique local display prefix. No hook, input control,
// request, source lookup, storage or publication operation is introduced here.
export function EvaluationPreparationReadingView({bundle,context,prefix}:{bundle:unknown;context:unknown;prefix:string}){
 const reading=evaluationPreparationReading(bundle,context);
 if(!reading||typeof prefix!=="string"||!/^[A-Za-z0-9_.:-]{1,128}$/.test(prefix))return <p>Private bundle reading unavailable. No partial preparation is shown.</p>;
 const evaluation=reading.evaluation,referenceIds=new Map(evaluation.references.map(ref=>[ref.key,`${prefix}-evaluation-reference-${ref.statementNumber}-${ref.referenceNumber}`]));
 return <details><summary>Read the separate bundle together</summary><h4>Private combined preparation reading</h4>
  <p>All seven dimensions remain unverified editing material. Exact format and comparison binding establish no factual support, source rights, evaluator independence, valid causal design, independent review or publication approval.</p>
  <p>The old six-slot packet is read unchanged. Evaluation stays a separate dimension; entries are not matched across measures or institutions. Worksheet order is not chronology, a progress score or evidence that an intervention caused an outcome.</p>
  <nav aria-label="Separate bundle reading sections"><ul><li><a href={`#${prefix}-legacy`}>Existing six-slot preparation</a></li><li><a href={`#${prefix}-evaluation`}>Separate evaluation preparation</a></li></ul></nav>
  <section id={`${prefix}-legacy`} tabIndex={-1}><h5>Existing six-slot preparation</h5>{reading.packet===null?<p>No six-slot packet copy supplied. This is not a finding about available evidence or action.</p>:<PreparationReadingView packet={reading.packet} context={reading.context} prefix={`${prefix}-legacy`}/>}</section>
  <section id={`${prefix}-evaluation`} tabIndex={-1}><h5>Separate evaluation preparation</h5>
   <p><a href="#proposal-evaluation-preparation">Open evaluation worksheet (expand)</a>. Reopen this part's exact copied preparation there explicitly before editing.</p>
   <p>Preserve the evaluation's own finding, design, comparison and limitations as attributed wording. A named evaluator does not establish independence; an observed change after a measure is not a causal finding by TerraFracta. Unknown limitations do not mean there are none.</p>
   {evaluation.status==='not_supplied'?<p>No evaluation copy supplied. This does not establish that no evaluation exists.</p>:evaluation.status==='empty'?<p>Supplied evaluation copy contains no entries. This is not evidence of no effect or no research.</p>:<ol>{evaluation.entries.map((entry,index)=><li key={index}>
    <p><a href={entry.statement.href}>Proposed statement {entry.statement.number} · {entry.statement.label} · <bdi>{entry.statement.period}</bdi></a></p>
    <dl>{entry.fields.map(field=><div key={field.key} id={`${prefix}-evaluation-${index+1}-${field.key}`} tabIndex={-1}><dt>{field.label}</dt><dd>{field.value===null?<p>Not supplied in this evaluation preparation</p>:<><p><bdi>{field.value}</bdi></p><ul>{field.references.map(key=>{const ref=evaluation.references.find(ref=>ref.key===key)!;return <li key={key}><a href={`#${referenceIds.get(key)}`}>Proposed statement {ref.statementNumber} · reference {ref.referenceNumber}</a></li>;})}</ul></>}</dd></div>)}</dl>
   </li>)}</ol>}
   <section id={`${prefix}-evaluation-references`} tabIndex={-1}><h5>Evaluation reference choices</h5><p>Exact captured occurrences, not independent sources. Their original roles concern the captured statement, not this preparation's interpretation. Sharing references across fields does not establish independent confirmation.</p>
    {evaluation.references.length===0?<p>No field-specific reference choices supplied for evaluation. This does not describe which sources exist.</p>:<ul>{evaluation.references.map(ref=><li key={ref.key} id={referenceIds.get(ref.key)} tabIndex={-1}>
     <p>Proposed statement {ref.statementNumber} · reference {ref.referenceNumber}: <bdi>{ref.title}</bdi> · <bdi>{ref.locator}</bdi></p><p>Original relation to the captured statement: {ref.originalRelation}.</p>
     <ul>{ref.selections.map(selection=><li key={`${selection.entryNumber}-${selection.field}`}><a href={`#${prefix}-evaluation-${selection.entryNumber}-${selection.field}`}>Evaluation entry {selection.entryNumber} · {selection.label}</a></li>)}</ul><a href={ref.originalHref}>Inspect original captured reference</a>
    </li>)}</ul>}
   </section>
  </section>
 </details>;
}
