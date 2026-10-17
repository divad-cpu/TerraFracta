import { notFound } from "next/navigation";
import fixture from "../../../fixtures/fictional-html-appended-capture.json";
import { HtmlAppendedCaptureView } from "../../../src/html-appended-capture-view.tsx";
export const dynamic="force-dynamic";
export const metadata={title:"Invented saved HTML composition",robots:{index:false,follow:false}};
export default function HtmlCaptureSample(){
 if(process.env.NODE_ENV!=="development")notFound();
 return <div className="content-page"><h1>Invented saved HTML composition</h1><p>The development gate is not authentication. This static example performs no new storage read or publication.</p>
 <HtmlAppendedCaptureView raw={Buffer.from(fixture.rawBase64,"base64")} retainedIntentJson={fixture.retainedIntentJson} observedAt={fixture.observedAt} actualReport={fixture.actualReport}/>
 <nav aria-label="HTML composition chain"><a href="/editorial-preview/html-capture-history">Choose this example through its preparation record</a>{" · "}<a href="/editorial-preview/html-append-review">Back to the separate unexecuted whole-issue preparation</a>{" · "}<a href="/editorial-preview">Back to the review desk</a></nav></div>;
}
