// Callers check their closed key grammar before capture. Recheck each own
// descriptor at observation time: an earlier getter may remove or hide a field.
// Native descriptors avoid borrowing a prototype value or a Proxy get result.
export function captureOwnEnumerableSelectors(input: object, keys: readonly string[], stringsOnly: true, rethrow?: (error: unknown) => void): Record<string, string> | null;
export function captureOwnEnumerableSelectors(input: object, keys: readonly string[], stringsOnly?: false, rethrow?: (error: unknown) => void): Record<string, unknown> | null;
export function captureOwnEnumerableSelectors(input: object, keys: readonly string[], stringsOnly = false, rethrow?: (error: unknown) => void): Record<string, unknown> | null {
  try {
    const values = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor?.enumerable) return null;
      const value = Object.hasOwn(descriptor, "value") ? descriptor.value :
        descriptor.get ? Reflect.apply(descriptor.get, input, []) : undefined;
      if (stringsOnly && typeof value !== "string") return null;
      values[key] = value;
    }
    return values;
  } catch (error) { rethrow?.(error); return null; }
}
