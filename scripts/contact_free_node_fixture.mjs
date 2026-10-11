import { z } from "zod";
import { correctionTargetSchema } from "../src/correction-target.ts";
import { contactFreeCorrectionPolicy as limits } from "../src/contact-free-correction-policy.ts";

// Descriptor shape and internal consistency only; no authentication, authority
// to adopt a container, path access or process launch follows from parsing.
const IMAGE = "sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453";
const id = z.uuid().regex(/^[0-9a-f-]+$/);
const schema = z.strictObject({ schemaVersion: z.literal(1),
  container: z.string().regex(/^terrafracta_write_node_\d{8}t\d{6}z_[0-9a-f]{8}$/),
  stamp: z.string().regex(/^\d{8}T\d{6}Z-[0-9a-f]{8}$/), image: z.literal(IMAGE),
  clusterPath: z.string().regex(/^\/tmp\/tf-write-node-native-\d{8}T\d{6}Z-[0-9a-f]{8}\/cluster$/),
  executionId: id, receivedAtMs: z.number().int().safe().nonnegative().max(Number.MAX_SAFE_INTEGER - limits.recordLifetimeMs),
  target: correctionTargetSchema,
}).refine(value => value.container === "terrafracta_write_node_" + value.stamp.toLowerCase().replace("-", "_") &&
  value.clusterPath === "/tmp/tf-write-node-native-" + value.stamp + "/cluster");
export function checkInventedNodeFixture(input) {
  try { return { kind: "checked", fixture: schema.parse(input) }; }
  catch { return { kind: "held" }; }
}
