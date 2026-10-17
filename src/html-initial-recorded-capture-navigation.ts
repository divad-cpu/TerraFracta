import {parseHtmlRecordedCaptureQuery,htmlRecordedCaptureHref} from "./html-recorded-capture-navigation.ts";
// Reuse the exact closed two-selector grammar; only the fixed destination differs.
export const parseHtmlInitialRecordedCaptureQuery=parseHtmlRecordedCaptureQuery;
export function htmlInitialRecordedCaptureHref(preparationId:string,captureId?:string|null){return htmlRecordedCaptureHref(preparationId,captureId).replace("/html-capture-history","/html-initial-capture-history");}
