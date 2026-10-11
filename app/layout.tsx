import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { DemoNotice } from "./components";
import { SiteNavigation } from "./site-navigation";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "TerraFracta — Local prototype", template: "%s | TerraFracta" },
  description: "A local, illustrative interface prototype for evidence-led country and issue pages.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <a className="skip-link" href="#main">Skip to content</a>
        <div className="site-shell">
          <header className="site-header">
            <Link className="brand" href="/" aria-label="TerraFracta home">
              <span className="brand__symbol" aria-hidden="true">T<span>·</span>F</span>
              <span className="brand__name">TerraFracta<small>Evidence in context</small></span>
            </Link>
            <SiteNavigation />
            <span className="header-status">LOCAL PROTOTYPE <span aria-hidden="true">●</span></span>
          </header>
          <DemoNotice />
          <main id="main" tabIndex={-1}>{children}</main>
          <footer className="site-footer">
            <div>
              <strong>TerraFracta</strong>
              <p>A working interface for careful, source-linked public information.</p>
            </div>
            <nav aria-label="Footer navigation">
              <Link href="/issues">Issues</Link>
              <Link href="/countries">Countries</Link>
              <Link href="/methodology">Methodology</Link>
              <Link href="/sources">Sources</Link>
              <Link href="/about">About</Link>
              <Link href="/corrections">Correction draft</Link>
              {process.env.NODE_ENV === "development" && <Link href="/reader-preview/catalogue">Current dossier directory</Link>}
              {process.env.NODE_ENV === "development" && <Link href="/editorial-preview">Editorial preview</Link>}
              {process.env.NODE_ENV === "development" && <Link href="/evidence-preview">Evidence preview</Link>}
              {process.env.NODE_ENV === "development" && <Link href="/update-preview">Update preview</Link>}
              {process.env.NODE_ENV === "development" && <Link href="/source-preview">Source preparation</Link>}
              {process.env.NODE_ENV === "development" && <Link href="/connected-preview">Connected preview</Link>}
              {process.env.NODE_ENV === "development" && <Link href="/diagnostics-preview">Recorded errors</Link>}
            </nav>
            <p className="site-footer__note">Prototype content is illustrative. No real-world conclusion should be drawn from it.</p>
          </footer>
        </div>
      </body>
    </html>
  );
}
