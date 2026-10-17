import type { Metadata } from "next";
import { notFound, unstable_rethrow } from "next/navigation";
import { awaitRouteSelectors } from "../../../src/await-route-selectors.ts";
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
  let view: string, query: Record<string, string | string[] | undefined>, edition: number | null;
  try {
    const route = (await awaitRouteSelectors(props.params, unstable_rethrow)).value;
    if (route === null || typeof route !== "object" || Array.isArray(route)) notFound();
    view = (route as { view: string }).view;
    if (!connectedViews.includes(view as ConnectedView)) notFound();
    const selectors = (await awaitRouteSelectors(props.searchParams, unstable_rethrow)).value;
    if (selectors === null || typeof selectors !== "object" || Array.isArray(selectors)) notFound();
    query = selectors as Record<string, string | string[] | undefined>;
    if (Object.keys(query).some((key) => key !== "edition" && !(view === "search" && key === "q"))) notFound();
    edition = connectedEdition(query.edition);
  } catch (error) { unstable_rethrow(error); notFound(); }
  const outcome = await connectedFictionalStore().current(edition);
  const content = <ConnectedPreviewView outcome={outcome} view={view as ConnectedView} query={query.q ?? ""} />;
  return outcome.kind === "snapshot" ? <CurrentConnectedEdition expected={connectedStatusIdentity(outcome.snapshot)} key={outcome.snapshot.executionId}>{content}</CurrentConnectedEdition> : content;
}
