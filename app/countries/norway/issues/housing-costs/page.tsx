import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLink, EvidenceDisclosure, PageIntro, Tag } from "../../../../components";
import { demoIssue } from "../../../../../src/demo-content";
import { sampleIssuePath } from "../../../../../src/visitor-catalog.ts";
import { IllustrativeTimeline } from "../../../../illustrative-timeline";

export const metadata: Metadata = {
  title: "Illustrative housing costs dossier",
  description: "A fabricated example showing the structure of a future evidence dossier.",
};

export default function HousingCosts() {
  return (
    <div className="content-page dossier">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/countries">Countries</Link><span aria-hidden="true">/</span>
        <Link href="/countries/norway">Norway</Link><span aria-hidden="true">/</span>
        <span>Housing costs</span>
      </nav>

      <PageIntro eyebrow="Norway / Housing / Sample dossier" title={demoIssue.title}>
        <p>{demoIssue.summary}</p>
        <div className="intro-tags">
          <Tag tone="caution">Entire dossier is illustrative</Tag>
          <span>Evidence review: not performed</span>
        </div>
      </PageIntro>

      <section className="dossier-brief" aria-labelledby="dossier-brief-heading">
        <div className="section-heading"><div><p className="eyebrow">Start here</p><h2 id="dossier-brief-heading">The case in brief</h2></div><Tag tone="caution">No verified conclusions</Tag></div>
        <div className="dossier-brief__grid">
          <article><h3>Problem</h3><p>{demoIssue.brief.problem}</p><a href="#problem">See the definitions <span aria-hidden="true">↓</span></a></article>
          <article><h3>Response and delivery</h3><p>{demoIssue.brief.response}</p><a href="#response">Follow the records <span aria-hidden="true">↓</span></a></article>
          <article><h3>Outcomes and limits</h3><p>{demoIssue.brief.outcomes}</p><a href="#uncertainty">Understand the limits <span aria-hidden="true">↓</span></a></article>
        </div>
      </section>

      <section className="dossier-scope" aria-labelledby="dossier-scope-heading">
        <h2 id="dossier-scope-heading">Scope and reason for inclusion</h2>
        <dl>
          <div><dt>Affected population</dt><dd>{demoIssue.scope.population}</dd></div>
          <div><dt>Geographic scope</dt><dd>{demoIssue.scope.geography}</dd></div>
          <div><dt>Measurement definition</dt><dd>{demoIssue.scope.definition}</dd></div>
          <div><dt>Denominator</dt><dd>{demoIssue.scope.denominator}</dd></div>
          <div><dt>Observation periods</dt><dd>{demoIssue.scope.observationPeriods}</dd></div>
          <div><dt>Why this example was selected</dt><dd>{demoIssue.scope.selectionRationale}</dd></div>
        </dl>
        <p className="small-note">{demoIssue.scope.searchScope}</p>
      </section>

      <div className="dossier-layout">
        <div className="dossier-main">
          <section className="dossier-section" id="problem">
            <p className="eyebrow">01 / The problem</p>
            <h2>What would we measure?</h2>
            <p>The planned dossier would define who is affected, the housing-cost threshold, the time period and the survey population. The figures below are made up solely to test the presentation.</p>
            <div className="indicator-grid">
              {demoIssue.indicators.map((item) => (
                <div className="indicator" key={item.period}>
                  <span>{item.value}</span>
                  <strong>{item.label}</strong>
                  <small>{item.period} · fabricated value</small>
                  <small>Unit: illustrative percentage of hypothetical households. <a href="#dossier-scope-heading">Read the definition and denominator</a>.</small>
                  <EvidenceDisclosure subject={item.period} />
                </div>
              ))}
            </div>
            <p className="evidence-hint">Illustrative values have no source. They must be replaced with reviewed, attributed data before any public use.</p>
            <details className="definition-panel"><summary>Definitions and comparability</summary><dl><div><dt>Population</dt><dd>Hypothetical households; no survey population is supplied.</dd></div><div><dt>Unit</dt><dd>Illustrative percentages, not observed statistics.</dd></div><div><dt>Data periods</dt><dd>Example periods A and B; no calendar dates or fieldwork dates are supplied.</dd></div><div><dt>Comparison</dt><dd>The labels demonstrate a shared hypothetical definition. They cannot establish a real trend.</dd></div></dl></details>
            <Link className="section-correction" href="/corrections?section=problem">Preview a correction to this section</Link>
          </section>

          <section className="dossier-section" id="response">
            <p className="eyebrow">02 / The response</p>
            <h2>What action is documented?</h2>
            <p>Policy, implementation and outcomes appear as separate records so an announcement cannot be mistaken for delivery.</p>
            <IllustrativeTimeline records={demoIssue.timeline} />
            <Link className="section-correction" href="/corrections?section=response">Preview a correction to this section</Link>
          </section>

          <section className="dossier-section" id="uncertainty">
            <p className="eyebrow">03 / What remains unknown</p>
            <h2>A visible boundary on conclusions</h2>
            <p>This demonstration cannot establish the scale of an actual problem, whether a real response was delivered, or whether it affected outcomes. A future published page must state its search scope and the date of its last evidence review.</p>
            <div className="info-band">
              <strong>No public conclusion is available</strong>
              <p>Real evidence has not been qualified for display in this dossier. A collection or loading failure cannot be treated as evidence that no action occurred.</p>
            </div>
            <Link className="section-correction" href="/corrections?section=uncertainty">Preview a correction to this section</Link>
          </section>

          <section className="dossier-section" id="sources">
            <p className="eyebrow">04 / Evidence and source access</p><h2>What would support the wording?</h2>
            <p>No source is attached to this fabricated case. A published dossier needs adjacent source locations and dates, along with whether each source supports a statement, conflicts with it or provides context.</p>
            <dl className="evidence-checklist"><div><dt>Source publication date</dt><dd>Not supplied for this demonstration</dd></div><div><dt>Data period</dt><dd>Illustrative labels only</dd></div><div><dt>Last evidence review</dt><dd>Not performed for this sample</dd></div><div><dt>Public correction history</dt><dd>No published record exists for this sample</dd></div></dl>
            <ArrowLink href="/sources">Learn to read a source panel</ArrowLink>
            <Link className="section-correction" href="/corrections?section=sources">Preview a correction to this section</Link>
          </section>
        </div>

        <aside className="dossier-aside" aria-label="Dossier context">
          <div className="aside-card">
            <p className="eyebrow">In this dossier</p>
            <a href="#problem">01 The problem</a>
            <a href="#response">02 The response</a>
            <a href="#uncertainty">03 What remains unknown</a>
            <a href="#sources">04 Evidence and sources</a>
          </div>
          <div className="aside-card aside-card--warm">
            <p className="eyebrow">Evidence status</p>
            <h2>Not publication ready</h2>
            <p>No claim on this page is linked to verified evidence. The disclosure beside each example explains that absence.</p>
            <ArrowLink href="/sources">Source standards</ArrowLink>
          </div>
          <div className="aside-card">
            <p className="eyebrow">Something to correct?</p>
            <p>Try the local correction draft preview. It cannot send or save a report.</p>
            <ArrowLink href="/corrections">Open draft preview</ArrowLink>
            <p><Link href={sampleIssuePath}>Stable sample link</Link></p>
          </div>
        </aside>
      </div>
    </div>
  );
}
