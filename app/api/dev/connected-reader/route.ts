import { handleConnectedReaderStatus } from "../../../../src/server/connected-reader-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handleConnectedReaderStatus(request, process.env.NODE_ENV);
}
