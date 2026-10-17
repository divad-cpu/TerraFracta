import type { Metadata } from "next";
import { notFound, unstable_rethrow } from "next/navigation";
import { HeldDecisionsView } from "../../../src/operator-held-decisions-view";
import { readHeldDecisions } from "../../../src/server/operator-held-decisions-reader.ts";
import { heldBrowseSelection } from "../../../src/operator-held-browse.ts";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export const metadata:Metadata={title:"Held decisions",robots:{index:false,follow:false}};
export default async function HeldDecisionsPage(props:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
 if(process.env.NODE_ENV!=="development")notFound();
 let selected;try{selected=heldBrowseSelection(await props.searchParams, unstable_rethrow);}catch(error){unstable_rethrow(error);selected=null;}
 if(selected===null)return <HeldDecisionsView decision={{kind:"invalid_scope"}}/>;
 try{return <HeldDecisionsView decision={await readHeldDecisions(selected.scope)} selection={selected.scope} reason={selected.reason} referenceQuery={selected.referenceQuery} runReturn={selected.runReturn}/>;}
 catch{return <HeldDecisionsView decision={{kind:"unavailable"}} selection={selected.scope} reason={selected.reason} referenceQuery={selected.referenceQuery} runReturn={selected.runReturn}/>;}
}
