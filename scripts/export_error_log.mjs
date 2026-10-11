import { constants } from "node:fs";
import { open, lstat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, parse } from "node:path";
import { ErrorLogStore } from "../src/server/error-log-store.ts";
import { buildDiagnosticReport } from "../src/diagnostic-report.ts";

export async function exportErrorLog(directory, output) {
  if (!isAbsolute(output) || output !== resolve(output)) throw new Error("Absolute export path required");
  if (output === directory || output.startsWith(directory + "/")) throw new Error("Keep exports outside the diagnostic archive");
  let current = parse(output).root;
  for (const part of dirname(output).slice(current.length).split("/").filter(Boolean)) {
    current = join(current, part);
    if (!(await lstat(current)).isDirectory()) throw new Error("Export ancestor not accepted");
  }
  const parent = await lstat(dirname(output));
  if (!parent.isDirectory() || parent.uid !== process.getuid?.() || (parent.mode & 0o022) !== 0)
    throw new Error("Export parent not accepted");
  let inspection;
  try { inspection = await new ErrorLogStore(directory).inspect(); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  const bundle = buildDiagnosticReport(inspection ?? null);
  const held = await open(dirname(output), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const same = (a, b) => ["dev", "ino", "mode", "uid", "gid", "nlink", "size", "mtimeMs", "ctimeMs"].every(key => a[key] === b[key]);
  try {
    const actual = await held.stat();
    if (actual.dev !== parent.dev || actual.ino !== parent.ino) throw new Error("Export parent changed");
    const anchored = `/proc/self/fd/${held.fd}/${basename(output)}`;
    const file = await open(anchored, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const bytes = Buffer.from(JSON.stringify(bundle, null, 2) + "\n");
    let written;
    try {
      await file.writeFile(bytes); await file.sync(); written = await file.stat();
      const observed = Buffer.alloc(bytes.length + 1);
      let size = 0;
      while (size < observed.length) { const row = await file.read(observed, size, observed.length - size, size); if (!row.bytesRead) break; size += row.bytesRead; }
      if (!written.isFile() || written.nlink !== 1 || (written.mode & 0o077) !== 0 || written.uid !== process.getuid?.()
        || size !== bytes.length || !observed.subarray(0, size).equals(bytes)
        || !same(written, await file.stat()) || !same(written, await lstat(anchored))) throw new Error("Export file changed");
    } finally { await file.close(); }
    await held.sync();
    const after = await lstat(dirname(output));
    if (after.dev !== actual.dev || after.ino !== actual.ino || !after.isDirectory() || after.uid !== actual.uid || (after.mode & 0o022) !== 0
      || !same(written, await lstat(output))) throw new Error("Export identity changed");
  } finally { await held.close(); }
  return { events: bundle.events.length, inspectionComplete: bundle.inspectionComplete, archiveState: bundle.archiveState };
}

async function main() {
  const args = process.argv.slice(2);
  const valid = args.length === 2 && args[0] === "--output" || args.length === 4 && args[0] === "--output" && args[2] === "--directory";
  if (!valid) throw new Error("Use --output /absolute/new-report.json [--directory /absolute/private-log-directory]");
  const result = await exportErrorLog(args[3] ?? join(process.cwd(), ".local-error-log"), args[1]);
  process.stdout.write(JSON.stringify(result) + "\n");
}
if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main().catch(() => { process.stderr.write("Error log export unavailable; check the private directory and a new output filename.\n"); process.exitCode = 1; });
}
