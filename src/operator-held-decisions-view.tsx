import { auditRunReturnHref, auditRunReturnParams, canonicalAuditRunReturn, type OperatorAuditRunReturn } from "./operator-audit-navigation.ts";
import { recordedHoldReasonExplanation, recordedHoldExplanationNotice } from "./recorded-hold-reasons.ts";
import { OperatorWorkspaceNavigation } from "./operator-workspace-navigation-view.tsx";
import { PageIntro } from "../app/components";
import { heldDecisionsReportSchema, heldCheckNames, heldReasonCodes, type HeldDecisionScope, type HeldDecisionsReport } from "./operator-held-decisions.ts";
import { canonicalHeldDecisionScope, type HeldDecisionsReadDecision } from "./server/operator-held-decisions-reader.ts";
import { heldReasonFilter, heldBrowseHref } from "./operator-held-browse.ts";
import { capturedProposalHref } from "./operator-proposal-navigation.ts";
const labels={invalid_scope:["Choose a recorded run","The selection is invalid. No decisions were read."],
  unconfigured:["Held decision connection unavailable","The private connection is not configured. No decisions have been inspected."],
  unavailable:["Held decisions unavailable","The records could not be checked. Details are withheld; this is not an empty or healthy result."],
  not_found:["No matching recorded run","This checked run was not found. No decision details are shown."],
  changed:["Held decision list changed","The continuation anchor changed. Start a fresh read; stale details are withheld."]} as const;
export function HeldDecisionsView({decision,selection,reason,runReturn}:{decision:HeldDecisionsReadDecision;selection?:HeldDecisionScope;reason?:unknown;runReturn?:OperatorAuditRunReturn}) {
  let report:HeldDecisionsReport|null=null,held:keyof typeof labels="unavailable";
  let selected:HeldDecisionScope|null=null, expected:HeldDecisionScope|null=null;
  let returnSelection:Readonly<OperatorAuditRunReturn>|null=null;
  const filter=heldReasonFilter(reason);
  try {if(filter===null)held="invalid_scope";
    else {
      if(decision.kind!=="invalid_scope") {
        if(selection!==undefined)expected=canonicalHeldDecisionScope(selection);
        returnSelection=canonicalAuditRunReturn(runReturn);
      }
      if(decision.kind==="ok") {const parsed=heldDecisionsReportSchema.safeParse(decision.report);
    if(parsed.success && (selection===undefined || JSON.stringify(expected)===JSON.stringify(parsed.data.requested)))report=parsed.data;
  } else if(Object.hasOwn(labels,decision.kind))held=decision.kind;}} catch {}
  if(report!==null)selected=report.requested;
  else if(held!=="invalid_scope")selected=expected;
  const checkedReturn=selected && returnSelection?.runId===selected.runId ? returnSelection : null;
  const rows=report?.decisions.filter(row=>!filter || row.reasonCodes.includes(filter)) ?? [];
  return <div className="content-page"><PageIntro eyebrow="Development only / Recorded operator audit" title="Held decisions">
    <p>Read stored decisions that held a candidate back. This page has no approval, editing, collection or publication control.</p>
  </PageIntro><OperatorWorkspaceNavigation active="holds" context={selected ? { runId: selected.runId } : {}} />{report===null ? <section className="info-band" role="status"><h2>{labels[held][0]}</h2><p>{labels[held][1]}</p></section> : <>
    <p>Records observed (UTC): <time dateTime={report.observedAt}>{report.observedAt}</time>. Run: <code>{report.run.runId}</code> · {report.run.jurisdictionId}.</p>
    <p role="note">These are historical held decisions. Their presence does not establish current source health or public eligibility. Source keys reflect the registration observed by this query; qualifications refer to the recorded decision.</p>
    <section className="info-band"><h2>Proposal details are read separately</h2><p>This list contains recorded holds, not the proposed wording, issue target, exact conflicting evidence or translation review. Open the exact captured proposal link below when a capture exists. A missing conflict dossier does not mean there is no conflict.</p></section>
    <section aria-labelledby="held-list-heading"><h2 id="held-list-heading">Recorded holds</h2><p role="note">{recordedHoldExplanationNotice}</p>
    <form action="/editorial-preview/held" method="get" className="current-source-filters">
      <input type="hidden" name="runId" value={report.requested.runId}/>
      {Object.entries(auditRunReturnParams(checkedReturn)).map(([name,value])=><input key={name} type="hidden" name={name} value={value}/>)}
      {report.requested.cursor && <><input type="hidden" name="beforeDecidedAt" value={report.requested.cursor.decidedAt}/><input type="hidden" name="beforeDecisionId" value={report.requested.cursor.decisionId}/></>}
      <div><label htmlFor="held-reason-filter">Recorded reason on this page</label><select id="held-reason-filter" name="reason" defaultValue={filter ?? ""} aria-describedby="held-reason-help"><option value="">All disclosed reasons</option>{heldReasonCodes.map(code=><option key={code} value={code}>{code.replaceAll("_"," ")}</option>)}</select></div>
      <button type="submit">Apply reason filter</button><a href={heldBrowseHref(report.requested,"",checkedReturn)}>Clear this page’s reason filter</a>
      <p id="held-reason-help">This filters only the checked page, not the whole run. Older pages keep the selected filter and make a new read. Filtering does not clear a hold.</p>
    </form>
    <p role="status">Showing {rows.length} of {report.decisions.length} held decisions on this checked page.</p>
    {filter && report.decisions.some(row=>row.undisclosedReasonCount>0) && <p role="note">Some reason entries are withheld; matching decisions may be omitted. No displayed match does not establish that the reason is absent.</p>}
    {report.decisions.length===0 ? <div className="empty-state"><h3>No held decisions returned</h3><p>This checked page is empty. It does not establish successful processing or successful publication.</p></div> : rows.length===0 ? <div className="empty-state"><h3>No matching disclosed reason on this page</h3><p>Other pages or withheld reason entries may contain matches. This is not successful processing or successful publication.</p></div> : <ol className="current-source-list" aria-label="Recorded held decisions">{rows.map(row=><li key={row.decisionId}><article>
      <h3>Held · {row.sourceKey}</h3><p>Decision recorded (UTC): <time dateTime={row.decidedAt}>{row.decidedAt}</time></p>
      <dl><div><dt>Decision reference</dt><dd><code>{row.decisionId}</code></dd></div><div><dt>Source version reference</dt><dd><code>{row.sourceVersionId}</code></dd></div>
      <div><dt>Qualification reference at decision</dt><dd><code>{row.qualificationId}</code> · revision {row.qualificationRevision} · {row.qualificationDecision}</dd></div></dl>
      <p><a href={capturedProposalHref({runId:report.requested.runId,decisionId:row.decisionId},{scope:report.requested,reason:filter ?? "",...(checkedReturn ? {runReturn:checkedReturn} : {})})}>Inspect captured proposal</a> · A separate capture may be absent.</p>
      <h4>Recorded reasons</h4><ul>{row.reasonCodes.map((reason,index)=><li key={index}>{reason.replaceAll("_"," ")}<details><summary>Meaning of {reason.replaceAll("_"," ")}</summary><p>{recordedHoldReasonExplanation(reason)}</p></details></li>)}</ul>
      {row.undisclosedReasonCount>0 && <p>{row.undisclosedReasonCount} reason entries are not disclosed by this bounded view.</p>}
      <details><summary>Recorded fixed checks</summary><dl>{heldCheckNames.map(key=><div key={key}><dt>{key.replaceAll("_"," ")}</dt><dd>{row.checks[key]===null ? "Not recorded" : row.checks[key] ? "Recorded true" : "Recorded false"}</dd></div>)}</dl>
      {row.undisclosedCheckCount>0 && <p>{row.undisclosedCheckCount} other check fields are not disclosed.</p>}</details>
    </article></li>)}</ol>}
    <nav className="current-issue-nav" aria-label="Held decision pages">{report.nextCursor && <a href={heldBrowseHref({runId:report.requested.runId,cursor:report.nextCursor},filter ?? "",checkedReturn)}>Older held decisions</a>}
    <a href={heldBrowseHref({runId:report.requested.runId,cursor:null},filter ?? "",checkedReturn)}>Start a fresh held-decision read</a></nav>
    <p>{report.more ? "More older recorded decisions are available to inspect." : "No older continuation was returned for this checked page."} Each page makes a new read.</p></section>
  </>}<nav className="current-issue-nav" aria-label="Editorial workspace">
    {report===null && selected && <a href={heldBrowseHref({runId:selected.runId,cursor:null},filter ?? "",checkedReturn)}>Start a fresh held-decision read</a>}
    {checkedReturn ? <><a href={auditRunReturnHref(checkedReturn)}>Back to selected recorded-run page</a><p>Returning makes a new read; the old page is not a saved snapshot.</p></> : selected && <a href={`/editorial-preview/audit/select?${new URLSearchParams({runId:selected.runId})}`}>{report ? "Back to this recorded run" : "Back to the selected run"}</a>}
    <a href="/editorial-preview/audit/select">Choose another recorded run</a><a href="/editorial-preview">Back to the review desk</a></nav></div>;
}
