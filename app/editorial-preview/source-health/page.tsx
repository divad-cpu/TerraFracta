import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SourceMonitoringExplorer } from "../../../src/source-monitoring-explorer.tsx";
import { createInventedSourceMonitoringSnapshot } from "./example.ts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Invented source monitoring", robots: { index: false, follow: false } };

export default function SourceMonitoringExample() {
  if (process.env.NODE_ENV !== "development") notFound();
  const observation = createInventedSourceMonitoringSnapshot();
  return <div className="content-page"><header className="page-intro"><p className="eyebrow">Development only / Invented source monitoring</p>
    <h1>Source monitoring example</h1><p>Entirely invented observations. No source was checked by opening this page. The operational source-health connection remains unconfigured.</p></header>
    <SourceMonitoringExplorer input={observation} />
    <p><a href="/editorial-preview/source-discovery">Inspect an invented feed-discovery comparison</a></p>
    <p><a href="/editorial-preview/exceptions">Back to the workspace overview</a></p>
  </div>;
}
