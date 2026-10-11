import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connectedEdition } from "../../../src/connected-fictional-reader";
import { connectedViews, ConnectedPreviewView, type ConnectedView } from "../../../src/connected-preview-view";
import { connectedFictionalStore } from "../../../src/server/connected-fictional-store";
import { connectedStatusIdentity } from "../../../src/connected-reader-status";
import { CurrentConnectedEdition } from "../CurrentConnectedEdition";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = { title: "Connected fictional update", robots: { index: false, follow: false } };

export default async function ConnectedPage(props: {
  params: Promise<{ view: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Refuse before route parsing or filesystem access in production builds.
  if (process.env.NODE_ENV !== "development") notFound();
  const { params, searchParams } = props;
  const { view } = await params;
  if (!connectedViews.includes(view as ConnectedView)) notFound();
  const query = await searchParams;
  if (Object.keys(query).some((key) => key !== "edition" && !(view === "search" && key === "q"))) notFound();
  let edition: number | null;
  try { edition = connectedEdition(query.edition); } catch { notFound(); }
  const outcome = await connectedFictionalStore().current(edition);
  const content = <ConnectedPreviewView outcome={outcome} view={view as ConnectedView} query={query.q ?? ""} />;
  return outcome.kind === "snapshot" ? <CurrentConnectedEdition expected={connectedStatusIdentity(outcome.snapshot)} key={outcome.snapshot.executionId}>{content}</CurrentConnectedEdition> : content;
}
