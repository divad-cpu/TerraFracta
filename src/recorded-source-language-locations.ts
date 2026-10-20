import type { CapturedProposalEnvelope } from "./operator-proposal-capture.ts";
import type { recordedProposalSourceIndex } from "./recorded-proposal-source-index.ts";

type Receipts = Extract<CapturedProposalEnvelope, { status: "ok" }>["sourceReceipts"];
export type SourceLanguageLocations = NonNullable<ReturnType<typeof recordedSourceLanguageLocations>>;

// Presentation of already admitted captured receipts only. Codes are preserved
// exactly; no detection, translation decision or independent-source count.
export function recordedSourceLanguageLocations(receipts: Receipts, index: ReturnType<typeof recordedProposalSourceIndex>) {
  try {
    if (!Array.isArray(receipts) || receipts.length < 1 || receipts.length > 120) return null;
    const groups = new Map(index.groups.map(group => [group.sourceVersionId.toLowerCase(), group]));
    const codes = new Set<string>();
    const entries = receipts.map((receipt, position) => {
      const group = groups.get(receipt.sourceVersionId.toLowerCase()); if (!group) throw Error();
      if (receipt.languageCode !== null) codes.add(receipt.languageCode);
      return { receiptNumber: position + 1, sourceVersionId: receipt.sourceVersionId, languageCode: receipt.languageCode,
        receiptHref: `#proposal-source-receipt-${position + 1}`, usesHref: `#${group.anchor}` };
    });
    return { entries, codes: [...codes] };
  } catch { return null; }
}
export function matchingSourceLanguageLocations(locations: SourceLanguageLocations, selection: unknown) {
  if (typeof selection !== "string") return null;
  if (selection === "all") return locations.entries;
  if (selection === "missing") return locations.entries.filter(entry => entry.languageCode === null);
  if (!selection.startsWith("code:") || !locations.codes.includes(selection.slice(5))) return null;
  return locations.entries.filter(entry => entry.languageCode === selection.slice(5));
}
