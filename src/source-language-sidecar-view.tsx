import { z } from "zod";
import { publicIssueProjectionSchema } from "./public-issue-projection.ts";
import { sourceLanguageSidecarSchema, sourceLanguageSidecarJson } from "./source-language-sidecar.ts";
import { sourceLanguageSidecarSha256 } from "./server/source-language-sidecar.ts";
import { issueSourceIndex, issueSourceGroupAnchor } from "./issue-source-index.ts";
import { evidenceLabels } from "./issue-display-labels.ts";

const display = z.strictObject({
  issue: publicIssueProjectionSchema,
  sidecar: sourceLanguageSidecarSchema,
  sidecarSha256: z.string().regex(/^[0-9a-f]{64}$/),
  finalReviewedAt: z.iso.datetime({ offset: true }),
});
function checkedReading(input: unknown) {
  try {
    const value = display.parse(input), { issue, sidecar } = value;
    if (sourceLanguageSidecarJson(sidecar) === null || sourceLanguageSidecarSha256(sidecar) !== value.sidecarSha256 ||
        sidecar.publicationId !== issue.publicationId || sidecar.revision !== issue.revision) return null;
    // Raw snapshot binding is checked by the qualifier, not reconstructed from
    // a display projection that intentionally withholds unbound source dates.
    const index = issueSourceIndex(issue), languages = new Map(sidecar.sources.map(source => [source.sourceVersionId, source]));
    if (languages.size !== sidecar.sources.length || languages.size !== index.groups.length ||
        index.groups.some(group => !languages.has(group.sourceVersionId))) return null;
    return { value, rows: index.groups.map((group, number) => ({ group, number: number + 1,
      language: languages.get(group.sourceVersionId)!.originalLanguage })) };
  } catch { return null; }
}

// Separate server-rendered candidate display. Parsing and hashes do not prove
// factual review, rights or trusted acquisition; the pure qualifier is upstream.
// No source request, default-reader change, update or publication is performed.
export function SourceLanguageSidecarView({ candidate, prefix }: { candidate: unknown; prefix: string }) {
  const reading = checkedReading(candidate);
  if (!reading || typeof prefix !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(prefix))
    return <p>Source-language candidate unavailable. No partial language information is shown.</p>;
  return <section className="info-band" aria-label="Separate source-language candidate">
    <h2>Separate original-language candidate</h2>
    <p>This separate local contract carries source-described original-language wording for an exact publication and source version. It does not add language fields to the existing v1 publication. The unchanged evidence cards below still describe that original v1 format.</p>
    <p>Unknown means no reviewed wording was supplied here. A source's title, publisher, country, registration or English display title does not identify its original language. Several listed versions may share an original source; language wording establishes no independent confirmation, translation quality or factual support.</p>
    <p>Candidate metadata review: <time dateTime={reading.value.finalReviewedAt}>{reading.value.finalReviewedAt}</time>. This is separate from source publication, retrieval and the publication's last evidence review. It does not refresh the underlying evidence.</p>
    <ul>{reading.rows.map(({ group, number, language }) => <li key={group.sourceVersionId} id={`${prefix}-version-${number}`} tabIndex={-1}>
      <h3><a href={`#${issueSourceGroupAnchor(number - 1)}`}>Recorded source version {number}</a></h3>
      <dl><div><dt>Source-described original language</dt><dd>{language === null
        ? "Unknown — no reviewed original-language wording supplied"
        : <bdi>{language}</bdi>}</dd></div></dl>
      <p>The wording applies to this exact source version, not to every publication by its publisher.</p>
      <ul>{group.references.map(reference => <li key={reference.anchor}>
        <a href={`#${reference.anchor}`}>Reference {reference.referenceNumber}: <bdi>{reference.source.title}</bdi> · <bdi>{reference.source.locator}</bdi></a>
        <p>Original relation to the statement: {evidenceLabels[reference.source.relation]}.</p>
      </li>)}</ul>
    </li>)}</ul>
    <p>Successful local checks and invented accepted-looking review rows are not real language-competent review, source approval, rights, authentication or publication authority. Actual use requires those records and a consistent authorized read.</p>
  </section>;
}
