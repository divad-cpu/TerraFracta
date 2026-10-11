import type { Metadata } from "next";
import { notFound, unstable_rethrow } from "next/navigation";
import { OperatorAuditView } from "../../../src/operator-audit-view";
import { readOperatorAudit } from "../../../src/server/operator-audit-reader.ts";

import { auditBrowseSelection } from "../../../src/operator-audit-navigation.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = { title: "Recorded operator audit", robots: { index: false, follow: false } };

export default async function OperatorAuditPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  let selection;
  try { selection = auditBrowseSelection(await props.searchParams, unstable_rethrow); }
  catch (error) { unstable_rethrow(error); selection = null; }
  if (selection === null) return <OperatorAuditView decision={{ kind: "invalid_scope" }} />;
  try { return <OperatorAuditView decision={await readOperatorAudit(selection.scope)} selection={selection.scope} runReturn={selection.runReturn} outcome={selection.outcome} publicationKind={selection.publicationKind} />; }
  catch { return <OperatorAuditView decision={{ kind: "unavailable" }} selection={selection.scope} runReturn={selection.runReturn} outcome={selection.outcome} publicationKind={selection.publicationKind} />; }
}
