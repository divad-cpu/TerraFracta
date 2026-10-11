import { handleCurrentCopyScopeObservation } from "../../../../src/server/current-copy-scope.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return handleCurrentCopyScopeObservation(request, process.env.NODE_ENV); }
