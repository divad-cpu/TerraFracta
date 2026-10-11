import type { Metadata } from "next";
import { notFound, unstable_rethrow } from "next/navigation";
import { canonicalPublicIssueRoute, readPublicIssue } from "../../../../../src/server/public-issue-reader";
import { currentIssueSelection } from "../../../../../src/current-issue-navigation";
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
    const { params, searchParams } = input;
    const values = (await awaitRouteSelectors(params, unstable_rethrow)).value as Record<string, unknown>;
    if (values !== null && Object.keys(values).sort().join(",") === "country,issue,view") {
      route = canonicalPublicIssueRoute({ jurisdictionSlug: values.country, issueSlug: values.issue });
      selection = currentIssueSelection(values.view, (await awaitRouteSelectors(searchParams, unstable_rethrow)).value, unstable_rethrow);
    }
  } catch (error) { unstable_rethrow(error); /* An ordinary selector fault cannot select or read a current dossier. */ }
  if (route === null || selection === null) notFound();
  const decision = await readPublicIssue(route);
  const latestHref = `/reader-preview/${route.jurisdictionSlug}/${route.issueSlug}/${selection.view}`;
  return <CurrentIssueNavigationView decision={decision} selection={selection} latestHref={latestHref} />;
}
