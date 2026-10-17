import { searchMatchChunks } from "./search-match-chunks.ts";

// Native semantic marks only; no HTML parsing or client/browser work.
export function SearchMatchText({ text, query }: { text: string; query: unknown }) {
  return <>{searchMatchChunks(text, query).map((chunk, index) => chunk.matched ? <mark key={index}>{chunk.text}</mark> : chunk.text)}</>;
}
