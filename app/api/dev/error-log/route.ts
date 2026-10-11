import { createDiagnosticIntake } from "../../../../src/server/error-log-intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const intake = createDiagnosticIntake();
export async function POST(request: Request) { return intake(request, process.env.NODE_ENV); }
