import type { Metadata } from "next";
import { ArrowLink, PageIntro, Tag } from "../components";

export const metadata: Metadata = { title: "About TerraFracta", description: "Purpose, coverage, publication boundaries and current availability of TerraFracta." };

export default function About() {
  return <div className="content-page narrow-page">
    <PageIntro eyebrow="About / Purpose and accountability" title="Public issues, with evidence in view">
      <p>TerraFracta is being developed as a readable guide to public problems, documented responses and the evidence available about delivery and outcomes.</p>
    </PageIntro>
    <section className="about-grid" aria-labelledby="about-coverage"><article><h2 id="about-coverage">Current coverage</h2><Tag tone="caution">Demonstration only</Tag><p>One Norway housing case demonstrates the reading experience. Its figures and events are invented. No real dossier is published here.</p><ArrowLink href="/issues">Explore the sample</ArrowLink></article><article><h2>What readers should expect</h2><p>Source locations, dates, definitions and uncertainty beside the statements they support. An announcement, a delivery record and a measured outcome answer different questions.</p><ArrowLink href="/sources">Understand source panels</ArrowLink></article></section>
    <section className="about-section"><h2>Editorial independence and scope</h2><p>The proposed service explains documented conditions and actions. It does not recommend political choices, rank governments or infer that missing evidence means no action was taken.</p><p>Routine eligible facts are intended to update automatically under approved source rules. Unclear or unsupported changes stay out of public coverage until resolved.</p><ArrowLink href="/methodology">Read the evidence rules</ArrowLink></section>
    <section className="about-section">
      <h2>Operator, funding and contact</h2>
      <p><strong>Responsible organization:</strong> Fideli Solutions.</p>
      <p><strong>Registered entity:</strong> FIDELI JERNÆS (sole proprietorship).</p>
      <p><strong>Organization number:</strong> 996597369.</p>
      <p><strong>Email:</strong> <a href="mailto:david@fideli.no">david@fideli.no</a> (opens your email app; also for privacy and rights inquiries).</p>
      <p><strong>Funding:</strong> Disclosure is pending.</p>
      <p>Reader-report handling must be established before public operation. The correction draft below is an unsent exercise; this prototype has no submission service.</p>
      <ArrowLink href="/corrections">Try the unsent correction draft</ArrowLink>
    </section>
    <section className="info-band"><h2>Reading this prototype responsibly</h2><p>Use it to inspect the structure and suggest improvements. The display examples cannot support a conclusion about real conditions, authorities or policy effects.</p></section>
  </div>;
}
