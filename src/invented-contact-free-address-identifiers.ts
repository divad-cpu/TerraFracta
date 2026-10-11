import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { contactFreeCorrectionPolicy as limits } from "./contact-free-correction-policy.ts";

// Invented transport/key-material experiment only. No socket/header access,
// real address or credential creation, persistence, host trust or live limiter.
const instant = z.number().int().nonnegative().safe().max(Number.MAX_SAFE_INTEGER - limits.recordLifetimeMs);
const epochSchema = z.number().int().nonnegative().safe();
const materialSchema = z.array(z.number().int().min(0).max(255)).length(32);
const fixtureSchema = z.strictObject({ kind: z.literal("invented_public_key_material"),
  epoch: epochSchema, current: materialSchema, previous: materialSchema });
const rotationSchema = z.strictObject({ kind: z.literal("invented_public_key_rotation"),
  epoch: epochSchema, current: materialSchema });
const addressSchema = z.strictObject({ kind: z.literal("invented_transport_address"), address: z.string().min(1).max(45) });
const held = () => ({ kind: "held" as const });

function canonicalInventedAddress(address: string): string | null {
  const family = isIP(address);
  if (family === 0 || address.includes("%")) return null;
  let value = address;
  if (family === 6) {
    value = new URL("http://[" + address + "]/", "http://example.invalid").hostname.slice(1, -1);
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(value);
    if (mapped) {
      const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
      value = [high >> 8, high & 255, low >> 8, low & 255].join(".");
    }
  }
  // Only documentation-range fixtures are admitted; this is intentionally not
  // a general real transport adapter. No network request is made by URL parsing.
  return /^(192\.0\.2\.|198\.51\.100\.|203\.0\.113\.|2001:db8:)/.test(value) ? value : null;
}

function pseudonym(material: Buffer, epoch: number, address: string) {
  const digest = createHmac("sha256", material)
    .update(JSON.stringify(["TerraFracta/contact-free/invented-transport/v1", epoch, address]), "utf8").digest();
  // Opaque compatibility token for the existing admission contract, not a
  // randomly issued report identifier or an authentication credential.
  digest[6] = (digest[6] & 15) | 64; digest[8] = (digest[8] & 63) | 128;
  const hex = digest.subarray(0, 16).toString("hex"); digest.fill(0);
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}

export function createInventedContactFreeAddressIdentifiers(fixture: unknown, clock: () => unknown) {
  let selected: z.infer<typeof fixtureSchema>;
  try { selected = fixtureSchema.parse(fixture); } catch { return held(); }
  if (Buffer.from(selected.current).equals(Buffer.from(selected.previous))) return held();
  let epoch = selected.epoch, contextKnown = true, observingClock = false, lastNow = -1;
  const materials = new Map<number, Buffer>([[epoch, Buffer.from(selected.current)], [epoch - 1, Buffer.from(selected.previous)]]);
  selected.current.fill(0); selected.previous.fill(0);
  // The caller's invented buffers/arrays are separate copies; zeroing these
  // owned buffers is not a physical V8/OpenSSL erasure guarantee for all copies.
  function invalidate() {
    contextKnown = false;
    for (const material of materials.values()) material.fill(0);
    materials.clear();
  }
  function observe() {
    if (!contextKnown || observingClock) return null;
    observingClock = true;
    try {
      const now = instant.parse(clock());
      if (!contextKnown || now < lastNow) { invalidate(); return null; }
      lastNow = now;
      const observedEpoch = Math.floor(now / limits.addressWindowMs);
      for (const [at, material] of materials) {
        if (now >= (at + 2) * limits.addressWindowMs) { material.fill(0); materials.delete(at); }
      }
      if (observedEpoch < epoch || observedEpoch > epoch + 1) { invalidate(); return null; }
      return { now, epoch: observedEpoch };
    } catch { invalidate(); return null; }
    finally { observingClock = false; }
  }
  const transport = Object.freeze({
    identify(input: unknown) {
      try {
        const inputAddress = addressSchema.parse(input);
        const address = canonicalInventedAddress(inputAddress.address);
        if (address === null) return held();
        const observed = observe();
        if (!observed || observed.epoch !== epoch) return held();
        const current = materials.get(epoch), previous = materials.get(epoch - 1);
        if (!current || !previous) return held();
        return { kind: "invented_identifiers" as const, epoch,
          currentKey: pseudonym(current, epoch, address), previousKey: pseudonym(previous, epoch - 1, address),
          currentExpiresAtMs: (epoch + 2) * limits.addressWindowMs,
          previousExpiresAtMs: (epoch + 1) * limits.addressWindowMs };
      } catch { return held(); }
    },
  });
  const owner = Object.freeze({
    rotate(input: unknown) {
      try {
        const next = rotationSchema.parse(input), observed = observe();
        if (!observed || observed.epoch !== epoch + 1 || next.epoch !== observed.epoch) return held();
        const material = Buffer.from(next.current);
        if ([...materials.values()].some(prior => prior.equals(material))) { material.fill(0); return held(); }
        epoch = next.epoch; materials.set(epoch, material);
        return { kind: "rotated_invented" as const };
      } catch { return held(); }
    },
    invalidateForTrial() { invalidate(); return { kind: "unknown_for_trial" as const }; },
  });
  const inspection = Object.freeze({
    counts() {
      const observed = observe();
      return !observed ? held() : { kind: "counts" as const, epoch: observed.epoch, residentMaterials: materials.size };
    },
  });
  return { kind: "ready" as const, transport, owner, inspection };
}
