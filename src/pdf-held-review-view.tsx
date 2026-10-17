import {pdfHeldReview} from "./server/pdf-held-review.ts";
import {PdfHeldPreparationView} from "./pdf-held-preparation-view.tsx";
import {PdfExtractionReviewView} from "./pdf-extraction-review-view.tsx";

export function PdfHeldReviewView({bundle,expected,extractionReviewJson,extractionReviewSha256}:{bundle:unknown;expected:unknown;extractionReviewJson:unknown;extractionReviewSha256:unknown}) {
  const review=pdfHeldReview(bundle,expected,extractionReviewJson,extractionReviewSha256);
  if(!review)return <section><h2>PDF candidate and source context unavailable</h2><p>No partial candidate, selected text or private context is displayed.</p></section>;
  return <section aria-labelledby="pdf-combined-heading"><h2 id="pdf-combined-heading">PDF candidate and selected source context</h2>
    <p>The supplied candidate and selected-text report have the same original, page map, request, output and historical observations. This checks correspondence, not factual support, rights, authentication, capture or publication eligibility.</p>
    <p><a href="#pdf-result-selected-pages">Read this candidate’s changed selected text and exact earlier wording</a></p>
    <PdfHeldPreparationView bundle={review.candidate.parts} expected={review.candidate.expected}/>
    <PdfExtractionReviewView input={review.extraction}/>
  </section>;
}
