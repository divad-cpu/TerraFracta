import { planInventedContactFreeWriteRecovery } from "../src/invented-contact-free-write-recovery.ts";

// Adapt the existing closed canonical-UTF8 inventory pipe for bounded additional
// operation metadata. No HTTP handler, host trust credential or restore follows.
let result = { kind: "held" };
try {
  if (process.argv.length !== 2) throw Error("Arguments refused");
  const chunks = []; let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.byteLength;
    if (size > 1024 * 1024) throw Error("Invented inventory limit");
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  if (!Buffer.from(text, "utf8").equals(bytes)) throw Error("Invented bytes differ");
  const packet = JSON.parse(text);
  if (JSON.stringify(packet) !== text || typeof packet !== "object" || packet === null || Array.isArray(packet) ||
      Object.keys(packet).sort().join(",") !== "backup,latest,nowMs") throw Error("Invented wire differs");
  result = planInventedContactFreeWriteRecovery(packet.backup, packet.latest, packet.nowMs);
} catch { /* No private body, URL, exception or digest is returned. */ }
process.stdout.write(JSON.stringify(result) + "\n");
process.exitCode = result.kind === "planned_invented_write_recovery" ? 0 : 2;
