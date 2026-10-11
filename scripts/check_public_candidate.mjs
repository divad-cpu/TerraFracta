import { interpretPublicReadCandidate } from "../src/public-read-outcome.ts";

// Pure private-row consistency checker. No database, HTTP or browser access.
if (process.argv.length !== 2) throw new Error("The bounded checker accepts no arguments");
let size = 0;
const chunks = [];
try {
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 256 * 1024) throw new Error();
    chunks.push(chunk);
  }
  const candidate = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  const outcome = interpretPublicReadCandidate(candidate);
  if (outcome.kind !== "issue") throw new Error();
  process.stdout.write(`${JSON.stringify(outcome.issue)}\n`);
} catch {
  process.stderr.write("Public candidate is inconsistent\n");
  process.exitCode = 1;
}
