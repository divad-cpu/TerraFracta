import { createDiagnosticDownload } from "../../../../../src/server/diagnostic-download.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const download = createDiagnosticDownload();
export const GET = (request: Request) => download(request, process.env.NODE_ENV);
