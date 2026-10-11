// Callers must first validate the existing nonzero-year UTC schema with at most six fractional digits.
// The schema admits microseconds; Date comparisons alone round them to milliseconds.
export function schemaCheckedUtcMicroseconds(value: string): bigint {
  const fraction = /\.([0-9]{1,6})/.exec(value)?.[1] ?? "";
  return BigInt(Date.parse(value.slice(0, 19) + "Z")) * BigInt(1000)
    + BigInt(fraction.padEnd(6, "0") || "0");
}

// Preserve finite millisecond clocks exactly, including fractional/negative values.
// Multiplying an absolute Number by 1000 can round it onto a future microsecond.
function clockMicros(value: number): { numerator: bigint; denominator: bigint } {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const exponent = Number((bits >> BigInt(52)) & BigInt(2047));
  const fraction = bits & ((BigInt(1) << BigInt(52)) - BigInt(1));
  const significand = exponent === 0 ? fraction : fraction + (BigInt(1) << BigInt(52));
  const power = (exponent === 0 ? 1 : exponent) - 1023 - 52;
  const sign = bits >> BigInt(63) ? -BigInt(1) : BigInt(1);
  const scaled = sign * significand * BigInt(1000);
  return power >= 0
    ? { numerator: scaled << BigInt(power), denominator: BigInt(1) }
    : { numerator: scaled, denominator: BigInt(1) << BigInt(-power) };
}

export function isRecentUtcObservation(value: string, now: number): boolean {
  if (!Number.isFinite(now)) return false;
  const clock = clockMicros(now);
  const age = clock.numerator - schemaCheckedUtcMicroseconds(value) * clock.denominator;
  return age >= BigInt(0) && age <= BigInt(30_000_000) * clock.denominator;
}
