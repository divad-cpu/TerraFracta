"use client";

import Link from "next/link";
import { ErrorReference } from "./error-reference";

export default function ErrorPage({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  // Error bodies and digests may contain private diagnostics. Display none.
  return <section className="content-page narrow-page" aria-labelledby="page-error-heading">
    <p className="eyebrow">Temporary reading problem</p><h1 id="page-error-heading">This page is temporarily unavailable</h1>
    <p>The page could not be loaded. No conclusion about the evidence can be drawn from this failure.</p>
    <ErrorReference />
    <div className="availability-actions"><button className="button button--primary" type="button" onClick={() => retry()}>Try loading again</button><Link className="arrow-link" href="/issues">Explore the available case</Link></div>
  </section>;
}
