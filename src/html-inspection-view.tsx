import { htmlInspectionReport } from "./server/html-inspection-report.ts";

export function HtmlInspectionView({ input }: { input: unknown }) {
  const report = htmlInspectionReport(input);
  if (!report) return <section><h2>HTML comparison unavailable</h2><p>No partial source text or request references are displayed.</p></section>;
  const { current, previous, selection } = report;
  const heading = selection.state === "held" ? "Selected text exceeds the request limit" : previous === null ?
    "No earlier document was supplied" : report.source_bytes_changed ?
    selection.state === "no_model_work" ? "Original HTML changed; selected text is unchanged" : "Selected text changed" : "Selected text is unchanged";
  const earlier = new Map(previous?.passages.map(p => [p.locator, p]) ?? []);
  return <section aria-labelledby="html-inspection-heading"><h2 id="html-inspection-heading">Selected HTML text comparison</h2>
    <p>Entirely invented offline example. This is parsed source text from explicitly selected elements. It is not the rendered page, a factual assessment or a stored-document receipt.</p>
    <div className="info-band"><h3>{heading}</h3><p>{previous === null ? "An absent supplied baseline does not mean that the source is new or has no earlier history." :
      "The comparison covers the selected elements only. Changes elsewhere in the document have not been assessed."}</p>
      <p>{selection.state === "held" ? "No extraction request is available for this comparison." : selection.state === "no_model_work" ?
        "No new extraction request is prepared for the identical selected text. This does not establish that published claims remain current." :
        "Changed selected text can be prepared for private extraction. Source rights, language qualification and factual support still require separate assessment."}</p></div>
    <nav aria-label="Selected HTML passages"><ul>{current.passages.map((p, i) => <li key={p.locator}><a href={`#html-passage-${i + 1}`}>Selected passage {i + 1}: <bdi>{p.locator}</bdi></a></li>)}</ul></nav>
    <h3>Current and earlier selected text</h3>
    {current.passages.map((p, i) => {
      const old = earlier.get(p.locator);
      return <article key={p.locator} id={`html-passage-${i + 1}`} tabIndex={-1}><h4>Selected passage {i + 1}</h4>
        <p>Locator: <code>{p.locator}</code>. {old === undefined ? "No earlier selected text was supplied." : old.text === p.text ? "Selected text is identical." : "Selected text differs from the supplied earlier document."}</p>
        <h5>Current parsed text</h5><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}><bdi>{p.text}</bdi></pre>
        {old !== undefined ? <details><summary>Earlier parsed text at the same locator</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}><bdi>{old.text}</bdi></pre></details> : null}
        <details><summary>Original-element and derived-text references</summary>
          {[p, ...(old ? [old] : [])].map((span, index) => <dl key={index}><dt>{index === 0 ? "Current" : "Earlier"} selected element / original UTF-8 byte range</dt><dd><code>{span.element_id}</code> / {span.start}–{span.end} (end excluded)</dd>
            <dt>Original outer-element hash, including markup</dt><dd><code>{span.raw_sha256}</code></dd>
            <dt>Derived parsed-text hash</dt><dd><code>{span.text_sha256}</code></dd></dl>)}
        </details><p><a href="#html-inspection-heading">Back to comparison overview</a></p></article>;
    })}
    <h3>Supplied document versions</h3>
    {[current, ...(previous ? [previous] : [])].map((s, i) => <details key={i}><summary>{i === 0 ? "Current supplied original" : "Earlier supplied original"}</summary><dl>
      <dt>Source / item / version</dt><dd><bdi>{s.source_key}</bdi> / <bdi>{s.item_key}</bdi> / <code>{s.source_version_id}</code></dd>
      <dt>Address, not opened</dt><dd><bdi>{s.source_url}</bdi></dd><dt>Original HTML bytes / hash</dt><dd>{s.original_bytes} / <code>{s.content_sha256}</code></dd>
      <dt>Supplied retrieval time</dt><dd><time dateTime={s.retrieved_at}>{s.retrieved_at}</time>. This is not a source publication date.</dd>
      <dt>Supplied language / independent mapping hash</dt><dd><code>{s.language_code}</code> / <code>{s.mapping_sha256}</code></dd>
      <dt>Derivation manifest hash</dt><dd><code>{s.derivation_manifest_sha256}</code></dd>
      <dt>Extraction profile / parser</dt><dd><code>{s.adapter_identity}</code> / <code>{s.parser_identity}</code></dd></dl></details>)}
    <h3>Private extraction request</h3>
    {report.request ? <><p>The producer recompiled and matched the complete supplied request. This preview receives references only; it does not verify the omitted request bytes or call a model.</p><dl>
      <dt>Request / selected-payload hash</dt><dd><code>{report.request.request_sha256}</code> / <code>{report.request.selected_payload_sha256}</code></dd>
      <dt>Request bytes / supplied maximum output tokens</dt><dd>{report.request.body_bytes} / {report.request.maximum_output_tokens}. These are not measured provider usage.</dd></dl></> :
      <p>No compiled request was supplied. This view does not prepare one or infer permission to dispatch.</p>}
    <p>The Python producer rederives both supplied originals before projecting this report. This preview checks report consistency and text hashes; original HTML is omitted and is not independently re-extracted here.</p>
    <p>Storage and provider usage are not observed. Source, rights and language qualification are not established; semantic support is not assessed. No approval, publication or automated operation is available.</p>
  </section>;
}
