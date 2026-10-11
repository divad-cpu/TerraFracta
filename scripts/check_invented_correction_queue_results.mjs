// Bounded pure queue/detail check. No SQL, identity, storage or web transport.
import { z } from "zod";
import { parseInventedQueuePage, parseInventedReviewDetail } from "../src/invented-correction-queue.ts";
if (process.argv.length !== 2) throw new Error("Fixed invented queue check takes no arguments");
let body = Buffer.alloc(0);
for await (const chunk of process.stdin) {
  body = Buffer.concat([body, chunk]);
  if (body.length > 16_384) throw new Error("Invented queue contract exceeds limit");
}
const packet = z.strictObject({ kind: z.enum(["queue", "detail"]), request: z.unknown(), result: z.unknown() })
  .parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)));
if (packet.kind === "queue") parseInventedQueuePage(packet.result, packet.request);
else parseInventedReviewDetail(packet.result, packet.request);
process.stdout.write(JSON.stringify({ schemaVersion: 1, evidenceKind: "checked_private_invented_queue_contract",
  kind: packet.kind, sourceRequests: 0, liveReviewEnabled: false }));
