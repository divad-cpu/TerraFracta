import type { Metadata } from "next";
import { notFound, unstable_rethrow } from "next/navigation";
import { ProposalComparisonView } from "../../../../src/operator-proposal-view";
import { readCapturedProposal } from "../../../../src/server/operator-proposal-reader.ts";
import { proposalBrowseSelection } from "../../../../src/operator-proposal-navigation.ts";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = { title: "Private proposal comparison", robots: { index: false, follow: false } };
export default async function ProposalPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  let query, selected;
  try { query = await props.searchParams; selected = proposalBrowseSelection(query, unstable_rethrow); } catch (error) { unstable_rethrow(error); selected = null; }
  if (selected === null) return <ProposalComparisonView decision={{ kind: "invalid_scope" }} />;
  try { return <ProposalComparisonView decision={await readCapturedProposal(selected.scope)} selection={selected.scope} browseQuery={selected.query} />; }
  catch { return <ProposalComparisonView decision={{ kind: "unavailable" }} selection={selected.scope} browseQuery={selected.query} />; }
}
