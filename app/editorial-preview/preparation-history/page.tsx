import type { Metadata } from "next";
import { notFound,unstable_rethrow } from "next/navigation";
import { captureOwnEnumerableSelectors } from "../../../src/own-enumerable-selectors.ts";
import { DetachedPreparationChoicesView } from "../../../src/detached-preparation-choices-view.tsx";
import invented from "../../../fixtures/fictional-detached-preparation-history.json";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title:"Choose an invented historical preparation",robots:{index:false,follow:false} };
function selected(query:unknown):string|undefined|null {
  if(typeof query!=="object"||query===null||Array.isArray(query))return null;
  const keys=Object.keys(query);if(keys.some(key=>key!=="preparation"))return null;
  const captured=captureOwnEnumerableSelectors(query,keys,true,unstable_rethrow);
  if(captured===null)return null;if(!keys.length)return undefined;
  return typeof captured.preparation==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(captured.preparation)?captured.preparation:null;
}
export default async function PreparationHistory({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  if(process.env.NODE_ENV!=="development")notFound();
  let choice:string|undefined|null;
  try { choice=selected(await searchParams); } catch(error) { unstable_rethrow(error);choice=null; }
  const record=typeof choice==="string"?invented.reports.find(report=>report.operationId===choice):undefined;
  return <div className="content-page"><header className="page-intro"><p className="eyebrow">Development only / Recorded invented preparations</p>
    <h1>Historical preparation choices</h1><p>Fixed reports from retained local exercises. The development gate is not authentication.</p></header>
    <DetachedPreparationChoicesView raw={invented.choicesJson} expected={invented.expectedChoices} selected={choice} selectedRaw={record?.reportJson} selectedExpected={record?.expected} />
    <p><a href="/editorial-preview">Back to the review desk</a></p><p><a href="/editorial-preview/preparation-sample">Inspect the fixed single-report example</a></p></div>;
}
