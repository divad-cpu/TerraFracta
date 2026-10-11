import Link from "next/link";
import type { ReactNode } from "react";

export function DemoNotice() {
  return (
    <div className="demo-notice" role="note">
      <span className="demo-notice__mark" aria-hidden="true">✳</span>
      <p><strong>Local demonstration.</strong> All issue figures and events on these screens are illustrative. No real source collection, editorial approval, or public publication is connected.</p>
    </div>
  );
}

export function PageIntro({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <header className="page-intro">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <div className="page-intro__body">{children}</div>
    </header>
  );
}

export function ArrowLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link className="arrow-link" href={href}>{children}<span aria-hidden="true"> ↗</span></Link>;
}

export function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "caution" | "good" }) {
  return <span className={`tag tag--${tone}`}>{children}</span>;
}

export function EvidenceDisclosure({ subject }: { subject: string }) {
  return (
    <details className="evidence-disclosure">
      <summary>Evidence for {subject}</summary>
      <p>This is fabricated display content. No source, review date or public claim is attached.</p>
      <Link href="/sources">What a real source panel requires</Link>
    </details>
  );
}
