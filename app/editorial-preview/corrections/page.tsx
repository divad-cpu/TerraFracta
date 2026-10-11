import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FictionalCorrectionExercise } from "./FictionalCorrectionExercise.tsx";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Controlled fictional correction workflow", robots: { index: false, follow: false } };
export default async function FictionalCorrectionPage(input: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const query = await input.searchParams;
  if (Object.keys(query).length) return <div className="content-page"><h1>Check the correction workflow link</h1><p>This exercise accepts no report, backend or storage selectors. Nothing was dispatched.</p><a href="/editorial-preview/corrections">Open the controlled exercise</a></div>;
  return <div className="content-page"><header className="page-intro"><p className="eyebrow">Development only / Corrections</p><h1>A traceable private correction lifecycle</h1><p>Prepare, confirm intake, inspect queue membership, review and recover a historical event in one controlled local execution.</p></header>
    <FictionalCorrectionExercise />
    <p><a href="/editorial-preview">Back to the review desk</a> · <a href="/corrections">Try the separate unsent free-text draft</a></p></div>;
}
