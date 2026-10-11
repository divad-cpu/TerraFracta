// Reuse the contact-free reader's intrinsic length accounting. A stream
// producer may reuse a buffer or shadow byteLength; charge/copy actual bytes.
const nativeByteLength = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype), "byteLength",
)!.get!;
const nativeSet = Uint8Array.prototype.set;

export function copyNativeByteChunk(target: Uint8Array, offset: number, value: unknown): number {
  if (!(value instanceof Uint8Array) || !Number.isSafeInteger(offset) || offset < 0) {
    throw new Error("Native byte chunk unavailable");
  }
  const length: number = Reflect.apply(nativeByteLength, value, []);
  const capacity: number = Reflect.apply(nativeByteLength, target, []);
  if (length < 1 || length > capacity - offset) throw new Error("Native byte chunk unavailable");
  // Copy before the next asynchronous read. The target is caller-owned and its
  // fixed capacity is the existing contract, never a producer-selected budget.
  Reflect.apply(nativeSet, target, [value, offset]);
  return length;
}

// ArrayBuffer.prototype alone does not establish native internal slots. Check
// the captured intrinsic brand and quota before any constructor can iterate a
// lookalike object. Existing typed-chunk behavior remains unchanged.
const nativeArrayBufferByteLength = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype, "byteLength",
)!.get!;

export function copyNativeArrayBuffer(target: Uint8Array, value: ArrayBuffer): number {
  const length: number = Reflect.apply(nativeArrayBufferByteLength, value, []);
  const capacity: number = Reflect.apply(nativeByteLength, target, []);
  if (length < 1 || length > capacity) throw new Error("Native byte buffer unavailable");
  return copyNativeByteChunk(target, 0, new Uint8Array(value));
}
