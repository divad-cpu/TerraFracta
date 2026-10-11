// Small bounded arithmetic aid; inputs are hypothetical shares, not source data.
// Scaled decimal integers keep the percentage-point difference exact.
// Constructors preserve the repository's existing TypeScript compilation target.
const scale = BigInt(10_000), zero = BigInt(0), one = BigInt(1), two = BigInt(2), hundred = BigInt(100);
function share(value: unknown) {
  if (typeof value !== "string" || value.length > 12) return null;
  const matched = /^(\d{1,3})(?:[.,](\d{1,4}))?$/.exec(value.trim());
  if (!matched) return null;
  const units = BigInt(matched[1]) * scale + BigInt((matched[2] ?? "").padEnd(4, "0"));
  return units <= hundred * scale ? units : null;
}
function decimal(units: bigint) {
  const magnitude = units < zero ? -units : units;
  const whole = magnitude / scale, fraction = (magnitude % scale).toString().padStart(4, "0").replace(/0+$/, "");
  return `${units < zero ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}
function roundedRatio(numerator: bigint, denominator: bigint) {
  const magnitude = numerator < zero ? -numerator : numerator;
  const scaled = magnitude * scale;
  const rounded = scaled / denominator + (scaled % denominator * two >= denominator ? one : zero);
  return decimal(numerator < zero ? -rounded : rounded);
}
export function compareShares(before: unknown, after: unknown) {
  const start = share(before), finish = share(after);
  if (start === null || finish === null) return { kind: "invalid" as const };
  const difference = finish - start;
  return { kind: "comparison" as const, before: decimal(start), after: decimal(finish),
    percentagePoints: decimal(difference), relativePercent: start === zero ? null : roundedRatio(difference * hundred, start),
    direction: difference > zero ? "increase" as const : difference < zero ? "decrease" as const : "unchanged" as const };
}
