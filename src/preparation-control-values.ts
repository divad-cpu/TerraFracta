import { checkedResponsibilityContext } from "./responsibility-draft.ts";
import type { ScopeDraftContext } from "./issue-scope-draft.ts";

// Detach one bounded, already collected native input for fixed editing hints.
// This does not inspect a DOM node, accept a draft or expose source text in hints.
export function collectedPreparationControls(input: unknown, rowIds: number[], contextInput: unknown,
  mode: "policy_event" | "delivery"): { rows: number[]; values: Map<string, string[]>; context: ScopeDraftContext } | null {
  try {
    const checked = checkedResponsibilityContext(contextInput);
    if (!checked || (mode !== "policy_event" && mode !== "delivery") || !Array.isArray(input) || !Array.isArray(rowIds)) return null;
    const length = input.length, rowCount = rowIds.length;
    if (!Number.isSafeInteger(length) || length < 0 || length > 544 || !Number.isSafeInteger(rowCount) || rowCount < 0 || rowCount > 8) return null;
    const rows: number[] = [], seenRows = new Set<number>();
    for (let index = 0; index < rowCount; index++) {
      const id = rowIds[index]; if (!Number.isSafeInteger(id) || id <= 0 || seenRows.has(id)) return null;
      seenRows.add(id); rows.push(id);
    }
    const singles = ["claim", mode === "policy_event" ? "kind" : "stage", "description", ...(mode === "delivery" ? ["coverage"] : []),
      "eventPrecision", "eventValue", "reportedPrecision", "reportedValue"];
    const referenceNames = [mode === "policy_event" ? "kind" : "stage", "description", ...(mode === "delivery" ? ["coverage"] : []), "eventDate", "reportedDate"];
    const names = new Set(rows.flatMap(id => [...singles, ...referenceNames.map(name => name + "References")].map(name => `${id}.${name}`)));
    const values = new Map<string, string[]>(); let bytes = 0;
    for (let index = 0; index < length; index++) {
      const pair = input[index]; if (!Array.isArray(pair) || pair.length !== 2) return null;
      const name = pair[0], value = pair[1];
      if (typeof name !== "string" || typeof value !== "string" || value.length > 16_384 || !names.has(name)) return null;
      bytes += new TextEncoder().encode(name + value).byteLength; if (bytes > 16_384) return null;
      const group = values.get(name) ?? []; group.push(value); values.set(name, group);
    }
    return { rows, values, context: checked.context };
  } catch { return null; }
}
