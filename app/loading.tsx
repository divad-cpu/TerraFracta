export default function Loading() {
  return <section className="content-page reading-loading" aria-busy="true" aria-label="Loading page">
    <p role="status">Loading the page…</p><div className="reading-loading__line" aria-hidden="true" /><div className="reading-loading__line" aria-hidden="true" />
  </section>;
}
