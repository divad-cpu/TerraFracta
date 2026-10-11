import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (_error, _request, context) => {
  // Do not inspect error, request headers/body/path or framework digest.
  if (process.env.NODE_ENV !== "development" || process.env.NEXT_RUNTIME !== "nodejs") return;
  try { const { recordServerError } = await import("./src/server/error-diagnostics"); await recordServerError(context.routeType); }
  catch { /* Observability must not change the failing operation. */ }
};
