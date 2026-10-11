import { handleCurrentPreparationObservation } from "../../../../src/server/current-private-preparation.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return handleCurrentPreparationObservation(request, process.env.NODE_ENV); }
