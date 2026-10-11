import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { diagnosticSelection } from "../../src/diagnostic-report.ts";
import { DiagnosticWorkspace } from "../../src/diagnostic-workspace-view.tsx";
import { readDevelopmentDiagnostics } from "../../src/server/diagnostic-reader.ts";
import { DiagnosticImportView } from "../../src/diagnostic-import-view.tsx";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = { title: "Private recorded errors", robots: { index: false, follow: false } };
export default async function DiagnosticsPreview(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const selection = diagnosticSelection(await props.searchParams);
  return <><DiagnosticWorkspace result={selection ? await readDevelopmentDiagnostics() : null} selection={selection} />
    <div className="content-page diagnostic-workspace"><DiagnosticImportView /></div></>;
}
