import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// Inspect generated manifests only; do not open private runtime files or start
// a server. This is a deployment-asset boundary, not HTTP route verification.
const forbidden = [".local-connected-reader", ".local-fictional-runs", ".local-connected-trial", ".local-error-log", "ssb-14059-raw", "TerraFracta-private-trials"];
async function manifests(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await manifests(path));
    else if (entry.isFile() && entry.name.endsWith(".nft.json")) found.push(path);
  }
  return found;
}
if (process.argv.length !== 2) throw new Error("Fixed build asset check accepts no arguments");
const paths = await manifests(join(process.cwd(), ".next"));
if (!paths.length) throw new Error("Build traces are missing; run the project build first");
for (const path of paths) {
  const trace = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(trace.files) || trace.files.some((file) => typeof file !== "string")) throw new Error("Build trace is invalid");
  if (trace.files.some((file) => forbidden.some((name) => file.split(/[\\/]/).includes(name)))) {
    throw new Error("A private local archive was included in build assets");
  }
}
process.stdout.write(JSON.stringify({ evidenceKind: "production_trace_private_archive_boundary", tracesChecked: paths.length, privateFilesIncluded: 0, browserVerified: false }) + "\n");
