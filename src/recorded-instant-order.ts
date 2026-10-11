// Compare schema-checked recorded ISO instants. Native Date converts whole
// seconds and UTC offsets; the decimal fraction keeps its admitted precision.
// This neither validates a record nor grants chronology/publication authority.
function instant(value: string) {
  const match = /^(.*?)(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new Error("Recorded time unavailable");
  const seconds = Date.parse(`${match[1]}${match[3]}`);
  if (!Number.isFinite(seconds)) throw new Error("Recorded time unavailable");
  return { seconds, fraction: (match[2] ?? "").replace(/0+$/, "") };
}

// Ascending chronological order. Equivalent offset/precision spellings are
// equal; record IDs belong to a caller's separate display-order tie breaker.
export function compareRecordedInstants(left: string, right: string): number {
  const a = instant(left), b = instant(right);
  if (a.seconds !== b.seconds) return a.seconds < b.seconds ? -1 : 1;
  return a.fraction === b.fraction ? 0 : a.fraction < b.fraction ? -1 : 1;
}
