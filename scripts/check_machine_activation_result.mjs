import { checkMachineActivationResult } from "../src/machine-activation-result.ts";

// Pure bounded stdin checker for the fixed development bridge. No SQL, source
// fetch, credentials, application writer, arbitrary file argument or commit.
if (process.argv.length !== 2) throw new Error("The bounded checker accepts no arguments");
const chunks = [];
let size = 0;
try {
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 256 * 1024) throw new Error();
    chunks.push(chunk);
  }
  const data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  if (data === null || typeof data !== "object" || Array.isArray(data) ||
      Object.keys(data).sort().join(",") !== "expected,result") throw new Error();
  const checked = checkMachineActivationResult(data.result, data.expected, new Date());
  process.stdout.write(`${JSON.stringify(checked)}\n`);
} catch {
  process.stderr.write("Activation receipt is inconsistent\n");
  process.exitCode = 1;
}
