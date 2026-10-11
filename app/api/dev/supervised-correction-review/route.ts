import { handleSupervisedCorrectionReviewObservation } from "../../../../src/server/supervised-correction-review-operation.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleSupervisedCorrectionReviewObservation(request, process.env.NODE_ENV);
