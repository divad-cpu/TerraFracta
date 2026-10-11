import type { Metadata } from "next";
import { notFound, unstable_rethrow } from "next/navigation";
import { loadCurrentVisitorCatalogue } from "../../../src/server/current-visitor-catalog.ts";
import { CurrentVisitorCatalogueView } from "../../../src/current-visitor-catalog-view.tsx";
import { awaitRouteSelectors } from "../../../src/await-route-selectors.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = { title: "Current dossier directory", robots: { index: false, follow: false } };
export default async function CurrentCataloguePage(input: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  const result = await loadCurrentVisitorCatalogue((await awaitRouteSelectors(input.searchParams, unstable_rethrow)).value, undefined, undefined, undefined, unstable_rethrow);
  return <CurrentVisitorCatalogueView result={result} />;
}
