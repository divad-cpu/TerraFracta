import { copyNativeArrayBuffer } from "./native-byte-chunk.ts";
import { reopenPreparationPacketJson, PREPARATION_PACKET_BYTES, type PreparationPacket } from "./preparation-packet.ts";

// Same intrinsic byte ownership and fatal UTF-8 decoding as the established
// scope/responsibility imports, with the packet's distinct exact codec/quota.
export function readPreparationPacketFile(bytes: ArrayBuffer, expectedBytes: number, context: unknown): PreparationPacket | null {
  try {
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 2 || expectedBytes > PREPARATION_PACKET_BYTES) return null;
    const owned = new Uint8Array(PREPARATION_PACKET_BYTES), size = copyNativeArrayBuffer(owned, bytes);
    if (size !== expectedBytes) return null;
    const json = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(owned.subarray(0, size));
    return reopenPreparationPacketJson(json, context);
  } catch { return null; }
}
