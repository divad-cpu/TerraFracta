// A visible bridge to the existing reader, only in local development. No
// provider or current-publication status is inferred by this entry link.
export function CurrentDirectoryEntry() {
  if (process.env.NODE_ENV !== "development") return null;
  return <aside className="info-band current-directory-entry"><h2>Explore the current-reader directory</h2>
    <p>The separate development directory checks the selected current issue route and keeps its dossier, references and search on one edition. Its provider is not configured; it may show unavailable.</p>
    <a href="/reader-preview/catalogue">Open the current dossier directory</a></aside>;
}
