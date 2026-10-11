import { captureOwnEnumerableSelectors } from "../../../../src/own-enumerable-selectors.ts";
import type { Metadata } from "next";
import { notFound, unstable_rethrow } from "next/navigation";
import { OperatorAuditChoicesView } from "../../../../src/operator-audit-choices-view";
import { canonicalOperatorAuditChoice, canonicalOperatorAuditRunCursor, readOperatorAuditChoices } from "../../../../src/server/operator-audit-choices-reader.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = { title: "Choose a recorded audit", robots: { index: false, follow: false } };

function selectedScope(query: unknown) {
  if (typeof query !== "object" || query === null || Array.isArray(query)) return null;
  const input = query as Record<string, unknown>, keys = Object.keys(input);
  if (keys.some(key => !["runId", "beforeCreatedAt", "beforeRunId"].includes(key))) return null;
  if (keys.includes("beforeCreatedAt") !== keys.includes("beforeRunId")) return null;
  // Validation and the private read share one captured own-enumerable tuple.
  const fields = captureOwnEnumerableSelectors(input, keys, true, unstable_rethrow);
  if (fields === null) return null;
  const runId = canonicalOperatorAuditChoice(keys.includes("runId") ? fields.runId : null);
  const hasCursor = keys.includes("beforeCreatedAt") || keys.includes("beforeRunId");
  const cursor = canonicalOperatorAuditRunCursor(hasCursor ? { createdAt: fields.beforeCreatedAt, runId: fields.beforeRunId } : null);
  return runId === undefined || cursor === undefined ? null : { runId, cursor };
}

export default async function OperatorAuditChoicesPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  let selection;
  try { selection = selectedScope(await props.searchParams); }
  catch (error) { unstable_rethrow(error); selection = null; }
  if (selection === null) return <OperatorAuditChoicesView decision={{ kind: "invalid_scope" }} />;
  try { return <OperatorAuditChoicesView decision={await readOperatorAuditChoices(selection.runId, undefined, selection.cursor)} selection={selection.runId} cursor={selection.cursor} />; }
  catch { return <OperatorAuditChoicesView decision={{ kind: "unavailable" }} selection={selection.runId} cursor={selection.cursor} />; }
}
