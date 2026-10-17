import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppendedIssueReviewView } from "../../../src/appended-issue-review-view.tsx";
import invented from "../../../fixtures/fictional-appended-issue-review.json";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Invented whole-issue preparation",robots:{index:false,follow:false}};
export default function WholeIssueExample(){
  if(process.env.NODE_ENV!=="development")notFound();
  const example=invented.cases[0]!;
  return <div className="content-page"><header className="page-intro"><p className="eyebrow">Development only / Invented whole issue</p>
    <h1>Append-only whole-issue example</h1><p>A fixed two-statement invented baseline and one candidate. The development gate is not authentication.</p></header>
    <AppendedIssueReviewView bundle={example.bundle} expected={example.expected}/>
    <p><a href="/editorial-preview/capture-sample">Inspect the separate saved composition comparison</a></p>
    <p><a href="/editorial-preview/preparation-sample">Return to the single-candidate example</a></p><p><a href="/editorial-preview">Back to the review desk</a></p></div>;
}
