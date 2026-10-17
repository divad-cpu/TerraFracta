import { searchText } from "./search-text.ts";

type MatchChunk = { text: string; matched: boolean };

// Locate the existing literal search words in original display text. Marks
// preserve whole graphemes; normalization/lowercase never rewrite that text.
// This has no result-selection, evidence, ranking or source-access semantics.
export function searchMatchChunks(text: string, query: unknown): MatchChunk[] {
  const plain = () => [{ text, matched: false }];
  const checked = searchText(query);
  if (checked.kind !== "valid" || !checked.query) return plain();
  try {
    const normalized = text.normalize("NFKC"), folded = normalized.toLocaleLowerCase("en");
    const words = [...new Set(checked.query.toLocaleLowerCase("en").split(/\s+/u).filter(Boolean))];
    const ranges: [number, number][] = [];
    for (const word of words) {
      for (let at = folded.indexOf(word); at !== -1; at = folded.indexOf(word, at + 1)) ranges.push([at, at + word.length]);
    }
    if (!ranges.length) return plain();
    ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged: [number, number][] = [];
    for (const range of ranges) {
      const last = merged.at(-1);
      if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
      else merged.push([...range]);
    }
    const segments = [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text)];
    const normalizedParts = segments.map(part => part.segment.normalize("NFKC"));
    if (normalizedParts.join("") !== normalized) return plain();
    // Lowercase the complete text for context-sensitive letters (e.g. sigma).
    // Per-grapheme lengths only map those folded positions to original glyphs.
    const lengths = normalizedParts.map(part => part.toLocaleLowerCase("en").length);
    if (lengths.reduce((sum, length) => sum + length, 0) !== folded.length) return plain();
    const chunks: MatchChunk[] = [];
    let offset = 0, rangeIndex = 0;
    segments.forEach((part, index) => {
      const end = offset + lengths[index];
      while (rangeIndex < merged.length && merged[rangeIndex][1] <= offset) rangeIndex++;
      const matched = rangeIndex < merged.length && merged[rangeIndex][0] < end && merged[rangeIndex][1] > offset;
      const last = chunks.at(-1);
      if (last && last.matched === matched) last.text += part.segment;
      else chunks.push({ text: part.segment, matched });
      offset = end;
    });
    return chunks;
  } catch { return plain(); } // An unavailable mapper leaves exact readable text.
}
