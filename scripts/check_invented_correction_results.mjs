// Pure, bounded cross-language contract check. No intake, storage or credentials.
import { z } from "zod";
import { correctionRequestSchema, parseCorrectionRequestReceipt } from "../src/correction-request.ts";
import { parseInventedReviewRequest, parseInventedReviewReceipt, parseInventedReviewStatus } from "../src/invented-correction-review.ts";
if (process.argv.length !== 2) throw new Error("Fixed correction result check takes no arguments");
let body = Buffer.alloc(0);
for await (const chunk of process.stdin) {
  body = Buffer.concat([body, chunk]);
  if (body.length > 16_384) throw new Error("Correction contract input exceeds limit");
}
const packet = z.strictObject({ kind: z.enum(["request", "review", "status"]), request: z.unknown(), result: z.unknown() })
  .parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)));
if (packet.kind === "request") parseCorrectionRequestReceipt(packet.result, correctionRequestSchema.parse(packet.request));
else if (packet.kind === "review") parseInventedReviewReceipt(packet.result, parseInventedReviewRequest(packet.request));
else {
  if (packet.request !== null) throw new Error("Status check takes no request authority");
  parseInventedReviewStatus(packet.result);
}
process.stdout.write(JSON.stringify({ schemaVersion: 1, evidenceKind: "checked_private_invented_correction_contract",
  kind: packet.kind, sourceRequests: 0, liveIntakeEnabled: false }));
