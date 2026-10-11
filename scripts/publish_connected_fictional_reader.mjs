import { randomUUID } from "node:crypto";
import { parseConnectedReaderInput } from "../src/connected-fictional-reader.ts";
import { connectedFictionalStore } from "../src/server/connected-fictional-store.ts";

// Called only by the fixed local demonstration after its committed reader
// succeeds. No HTTP, caller paths, credentials, SQL or real source are accepted.
if (process.argv.length !== 2) throw new Error("The connected reader exporter accepts no arguments");
let size = 0;
const chunks = [];
try {
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("Display payload exceeds its bound");
    chunks.push(chunk);
  }
  const payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  const suppression = typeof payload === "object" && payload !== null &&
    Object.keys(payload).sort().join(",") === "reason,state" &&
    payload.state === "suppressed" && payload.reason === "fictional_source_rights_withdrawn";
  const input = parseConnectedReaderInput({
    schemaVersion: 1, evidenceKind: "connected_fictional_reader",
    executionId: randomUUID(), observedAt: new Date().toISOString(),
    actualSourceRequests: 0, modelCalls: 0, livePublicationEnabled: false,
    ...(suppression ? { state: "suppressed", issue: null, reason: payload.reason } : { state: "active", issue: payload }),
  });
  const store = connectedFictionalStore();
  const head = await store.current();
  if (!["empty", "snapshot"].includes(head.kind)) throw new Error("Existing connected archive needs review");
  const snapshot = await store.append(input, head.kind === "snapshot" ? head.snapshot.generation : null);
  const readback = await store.current(snapshot.generation);
  if (readback.kind !== "snapshot" || JSON.stringify(readback.snapshot) !== JSON.stringify(snapshot)) {
    throw new Error("Connected display readback differs");
  }
  process.stdout.write(JSON.stringify({
    evidenceKind: "connected_fictional_display_saved", generation: snapshot.generation,
    publicationId: snapshot.state === "active" ? snapshot.issue.publicationId : null,
    state: snapshot.state, projectionReadbackVerified: true,
    browserVisibilityVerified: false, productionEnabled: false,
    previewPath: `/connected-preview/issue?edition=${snapshot.generation}`,
  }) + "\n");
} catch {
  process.stderr.write("Connected fictional display was not accepted; previous files were preserved\n");
  process.exitCode = 1;
}
