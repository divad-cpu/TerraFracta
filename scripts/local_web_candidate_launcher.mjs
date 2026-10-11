// Local candidate only. Use a trusted Node executable with a clean environment.
// This does not seal interpreter startup or authorize hosting/publication.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

if (process.argv.length !== 2) throw new Error("The local candidate accepts no arguments");
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, {
  NODE_ENV: "production",
  HOSTNAME: "127.0.0.1",
  PORT: "3210",
  NEXT_TELEMETRY_DISABLED: "1",
});
process.chdir(dirname(fileURLToPath(import.meta.url)));
await import("./server.js");
