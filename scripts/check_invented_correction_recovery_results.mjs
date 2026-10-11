// Pure bounded lookup contract check; no SQL, retry, credentials or transport.
import { z } from "zod";
import { parseInventedReviewRecovery } from "../src/invented-correction-recovery.ts";
if (process.argv.length !== 2) throw new Error("Fixed invented recovery check takes no arguments");
let body = Buffer.alloc(0);
for await (const chunk of process.stdin) {
  body = Buffer.concat([body, chunk]);
  if (body.length > 16_384) throw new Error("Invented recovery contract exceeds limit");
}
const packet = z.strictObject({ request: z.unknown(), result: z.unknown() })
  .parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)));
parseInventedReviewRecovery(packet.result, packet.request);
process.stdout.write(JSON.stringify({ schemaVersion: 1, evidenceKind: "checked_private_invented_recovery_contract",
  sourceRequests: 0, liveReviewEnabled: false }));
