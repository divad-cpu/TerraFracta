import { handleCorrectionReviewObservation } from "../../../../src/server/correction-review-operation.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleCorrectionReviewObservation(request, process.env.NODE_ENV);
