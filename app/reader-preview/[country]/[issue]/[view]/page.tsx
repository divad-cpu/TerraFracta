import type { Metadata } from "next";
import { notFound, unstable_rethrow } from "next/navigation";
import { canonicalPublicIssueRoute, readPublicIssue } from "../../../../../src/server/public-issue-reader";
import { currentIssueSelection, currentIssueViews } from "../../../../../src/current-issue-navigation";
import { CurrentIssueNavigationView } from "../../../../../src/current-issue-navigation-view";
import { awaitRouteSelectors } from "../../../../../src/await-route-selectors.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = { title: "Current dossier reader", robots: { index: false, follow: false } };

export default async function CurrentDossierPage(input: {
  params: Promise<{ country: string; issue: string; view: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  let route: ReturnType<typeof canonicalPublicIssueRoute> = null;
  let selection: ReturnType<typeof currentIssueSelection> = null;
  try {
    const values = (await awaitRouteSelectors(input.params, unstable_rethrow)).value as Record<string, unknown>;
    if (values !== null && typeof values === "object" && !Array.isArray(values) && Object.keys(values).sort().join(",") === "country,issue,view") {
      route = canonicalPublicIssueRoute({ jurisdictionSlug: values.country, issueSlug: values.issue });
      const view = values.view;
      if (route !== null && currentIssueViews.includes(view as typeof currentIssueViews[number]))
        selection = currentIssueSelection(view, (await awaitRouteSelectors(input.searchParams, unstable_rethrow)).value, unstable_rethrow);
    }
  } catch (error) { unstable_rethrow(error); /* An ordinary selector fault cannot select or read a current dossier. */ }
  if (route === null || selection === null) notFound();
  const decision = await readPublicIssue(route);
  const latestHref = `/reader-preview/${route.jurisdictionSlug}/${route.issueSlug}/${selection.view}`;
  return <CurrentIssueNavigationView decision={decision} selection={selection} latestHref={latestHref} />;
}
