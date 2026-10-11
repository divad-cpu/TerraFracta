"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const destinations = [
  { href: "/issues", label: "Issues" }, { href: "/countries", label: "Countries" },
  { href: "/methodology", label: "Method" }, { href: "/sources", label: "Sources" },
  { href: "/about", label: "About" },
];

export function SiteNavigation() {
  const pathname = usePathname();
  return <nav className="site-nav" aria-label="Main navigation">
    {destinations.map(item => {
      const exact = pathname === item.href;
      const within = pathname?.startsWith(item.href + "/");
      return <Link key={item.href} href={item.href} aria-current={exact ? "page" : within ? "location" : undefined}>{item.label}</Link>;
    })}
  </nav>;
}
