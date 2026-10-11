import { handlePrivateCustodianRequest } from "../../../../src/server/private-custodian-operation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) { return handlePrivateCustodianRequest(request, process.env.NODE_ENV); }
export async function GET(request: Request) { return handlePrivateCustodianRequest(request, process.env.NODE_ENV); }
