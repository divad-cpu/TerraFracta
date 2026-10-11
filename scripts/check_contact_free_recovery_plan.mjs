import { planInventedCorrectionRecovery } from "../src/invented-contact-free-recovery.ts";

// Private invented trial pipe only, not an HTTP handler or a trust credential.
// Canonical UTF-8 JSON rejects duplicate keys/escaped aliases before planning.
let result = { kind: "held" };
try {
  if (process.argv.length !== 2) throw Error("Arguments refused");
  const chunks = []; let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.byteLength;
    if (size > 512 * 1024) throw Error("Fixture inventory limit");
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  if (!Buffer.from(text, "utf8").equals(bytes)) throw Error("Fixture bytes differ");
  const packet = JSON.parse(text);
  if (JSON.stringify(packet) !== text || typeof packet !== "object" || packet === null || Array.isArray(packet) ||
      Object.keys(packet).sort().join(",") !== "backup,latest,nowMs") throw Error("Fixture wire differs");
  result = planInventedCorrectionRecovery(packet.backup, packet.latest, packet.nowMs);
} catch { /* No payload, URL, exception body or digest enters this result. */ }
process.stdout.write(JSON.stringify(result) + "\n");
process.exitCode = result.kind === "planned" ? 0 : 2;
