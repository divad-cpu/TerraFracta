import assert from "node:assert/strict";

// These are checks of actual rendered test markup, not operational authority
// or a parser for untrusted HTML. Accepted local preparation is distinct from
// editing the captured publication, submitting a report or approving a source.
export function assertUnsentProposalControls(html, expectedButtons = ["Clear reference finder", "Show all reference choices",
  "Reopen scope preparation", "Review scope draft", "Clear scope draft", "Show all responsibility reference choices", "Add responsibility entry",
  "Review responsibility draft", "Clear responsibility draft", "Reopen responsibility preparation",
  "Show all indicator reference choices", "Add indicator entry", "Inspect unsent indicator draft", "Clear indicator draft", "Reopen indicator preparation",
  "Inspect combined preparation packet", "Clear preparation packet", "Read saved preparation packet", "Reopen preparation packet"]) {
  assert.match(html, /Captured content cannot be edited here/);
  assert.match(html, /Nothing is submitted, saved to the archive or published/);
  assert.doesNotMatch(html, /<form\b|type="submit"|method="post"/);
  const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
  assert.deepEqual(buttons.map(match => match[2]), expectedButtons);
  for (const [, attributes] of buttons) {
    assert.match(attributes, /(?:^|\s)type="button"(?:\s|$)/);
    assert.match(attributes, /(?:^|\s)disabled=""(?:\s|$)/);
  }
  // The preceding in-memory reference finder is read-only and usable. Scope
  // preparation still starts unadmitted; every field from that section onward
  // must remain disabled in these actual server-rendered comparisons.
  const preparationStart = html.indexOf('<details class="issue-scope-preparation"');
  assert.ok(preparationStart >= 0, "The checked comparison must contain its unsent preparation");
  const fields = [...html.slice(preparationStart).matchAll(/<(?:input|select|textarea)\b([^>]*)>/g)];
  assert.ok(fields.length > 0, "The unsent preparation must expose its represented fields");
  for (const [, attributes] of fields) assert.match(attributes, /(?:^|\s)disabled=""(?=\s|\/|$)/);
}

export function assertReadOnlyHeldForms(html) {
  const forms = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)];
  assert.equal(forms.length, 2);
  for (const [, attributes] of forms) {
    assert.match(attributes, /(?:^|\s)method="get"(?:\s|$)/);
    assert.match(attributes, /(?:^|\s)action="\/editorial-preview\/held"(?:\s|$)/);
  }
  const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
  assert.deepEqual(buttons.map(match => match[2]), ["Search held references", "Apply reason filter"]);
  for (const [, attributes] of buttons) assert.match(attributes, /(?:^|\s)type="submit"(?:\s|$)/);
  for (const [, attributes] of html.matchAll(/<input\b([^>]*)>/g)) {
    assert.match(attributes, /(?:^|\s)type="(?:hidden|search)"(?=\s|\/|$)/);
  }
  assert.doesNotMatch(html, /method="post"|formAction=|formaction=|formMethod=|formmethod=/);
}
