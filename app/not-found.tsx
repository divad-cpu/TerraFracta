import type { Metadata } from "next";
import { ArrowLink, PageIntro } from "./components";

export const metadata: Metadata = { title: "Page not found", robots: { index: false, follow: false } };

export default function NotFound() {
  return <div className="content-page narrow-page">
    <PageIntro eyebrow="Page unavailable" title="This page could not be found"><p>The link may be incomplete or the page may not be available. This is not evidence that an issue or public response does not exist.</p></PageIntro>
    <div className="availability-actions"><ArrowLink href="/issues">Explore the available case</ArrowLink><ArrowLink href="/countries">Browse countries</ArrowLink><ArrowLink href="/">Return home</ArrowLink></div>
  </div>;
}
