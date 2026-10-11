import { installClientErrorListeners } from "./src/client-error-diagnostics";

if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
  try { installClientErrorListeners(window); } catch { /* No recursive diagnostics. */ }
}
