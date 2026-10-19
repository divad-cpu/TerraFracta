import {parseHtmlRecordedCaptureQuery,htmlRecordedCaptureHref} from "./html-recorded-capture-navigation.ts";
// Reuse closed own-data two-selector grammar; only the fixed route differs.
export const parsePdfWholeRecordedCaptureQuery=parseHtmlRecordedCaptureQuery;
export function pdfWholeRecordedCaptureHref(preparationId:string,captureId?:string|null){return htmlRecordedCaptureHref(preparationId,captureId).replace("/html-capture-history","/pdf-whole-capture-history");}
