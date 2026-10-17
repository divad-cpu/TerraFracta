import type { Metadata } from "next";
import { notFound,unstable_rethrow } from "next/navigation";
import { canonicalProposalJson } from "../../../src/operator-proposal-capture.ts";
import { htmlPreparationHistory } from "../../../src/server/html-preparation-review-report.ts";
import { HtmlPreparationReviewView } from "../../../src/html-preparation-review-view.tsx";
import invented from "../../../fixtures/fictional-html-preparation-history.json";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Choose an illustrative historical HTML preparation",robots:{index:false,follow:false}};
function choice(query:unknown):string|undefined|null {
  try {
    if (query===null || typeof query!=="object" || Array.isArray(query) || ![Object.prototype,null].includes(Object.getPrototypeOf(query))) return null;
    const keys=Reflect.ownKeys(query);if (!keys.length) return undefined;
    if (keys.length!==1 || keys[0]!=="preparation") return null;
    const d=Object.getOwnPropertyDescriptor(query,"preparation");
    if (!d?.enumerable || !("value" in d) || typeof d.value!=="string") return null;
    return /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(d.value)?d.value:null;
  } catch(error) {unstable_rethrow(error);return null;}
}
export default async function HtmlPreparationHistory({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  if (process.env.NODE_ENV!=="development") notFound();
  let selected:string|undefined|null;
  try {selected=choice(await searchParams);} catch(error) {unstable_rethrow(error);selected=null;}
  const rows=htmlPreparationHistory(canonicalProposalJson(invented)),record=typeof selected==="string"?rows?.find(row=>row.operationId===selected):undefined;
  const unavailable=rows===null || selected===null || typeof selected==="string" && record===undefined;
  return <div className="content-page"><header className="page-intro"><p className="eyebrow">Development only / Illustrative HTML preparation history</p>
    <h1>Historical HTML preparation choices</h1><p>Synthetic complete receipts demonstrate this private reading flow. The development gate is not authentication.</p></header>
    {unavailable?<section><h2>Selected HTML preparation unavailable</h2><p>No candidate, context or source text is displayed.</p></section>:<>
      <section><h2>Choose a preparation explicitly</h2><p>These fixed metadata choices do not establish current context, source rights or an independent prewrite witness. No first or newest preparation is selected automatically.</p>
        <ul>{rows.map(row=><li key={row.operationId}><a href={`/editorial-preview/html-preparation-history?preparation=${encodeURIComponent(row.operationId)}`}>{row.label}</a></li>)}</ul></section>
      {record?<HtmlPreparationReviewView raw={record.reportJson} expected={record.expected}/>:null}</>}
    <p><a href="/editorial-preview/html-preparation-history">Return to the choice list</a></p>
    <p><a href="/editorial-preview/html-extraction-sample">Inspect the separate illustrative extraction</a></p>
    <p><a href="/editorial-preview/html-append-review">Inspect an invented complete issue with an HTML candidate appended</a></p>
    <p><a href="/editorial-preview">Back to the review desk</a></p></div>;
}
