import type { Metadata } from "next";
import { notFound, unstable_rethrow } from "next/navigation";
import { canonicalPublicIssueRoute, readPublicIssue } from "../../../../src/server/public-issue-reader";
import { PublicIssueReadView } from "../../../../src/public-issue-read-view";
import { awaitRouteSelectors } from "../../../../src/await-route-selectors.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = { title: "Local current-issue reader", robots: { index: false, follow: false } };
export default async function ReaderPage(input: {
  params: Promise<{ country: string; issue: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  let route: ReturnType<typeof canonicalPublicIssueRoute> = null;
  try {
    const values = (await awaitRouteSelectors(input.params, unstable_rethrow)).value as Record<string, unknown>;
    if (values !== null && typeof values === "object" && !Array.isArray(values) && Object.keys(values).sort().join(",") === "country,issue") {
      const candidate = canonicalPublicIssueRoute({ jurisdictionSlug: values.country, issueSlug: values.issue });
      if (candidate !== null) {
        const query = (await awaitRouteSelectors(input.searchParams, unstable_rethrow)).value as Record<string, unknown>;
        if (query !== null && !Object.keys(query).length) route = candidate;
      }
    }
  } catch (error) { unstable_rethrow(error); /* An ordinary selector fault cannot select or read a current dossier. */ }
  if (route === null) notFound();
  const decision = await readPublicIssue(route);
  return <PublicIssueReadView decision={decision} retryRoute={route} />;
}
