// Shared bounded display search. It has no path, SQL or network semantics.
export function searchText(value: unknown) {
  if (typeof value !== "string" || value.length > 80 || /[\u0000-\u001f\u007f]/.test(value)) {
    return { kind: "invalid" as const, query: "" };
  }
  const query = value.trim().normalize("NFKC");
  // Compatibility normalization can expand a short Unicode input.
  if (query.length > 80 || /[\u0000-\u001f\u007f]/.test(query)) return { kind: "invalid" as const, query: "" };
  return { kind: "valid" as const, query };
}
