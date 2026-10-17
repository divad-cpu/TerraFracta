import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { scopeDraftHarness } from "./helpers/scope_draft_harness.mjs";
import { capturedScopeDraftContext } from "../src/server/issue-scope-draft.ts";
import { proposalReport, proposalId } from "./helpers/proposal_fixture.mjs";

const input = (h, suffix) => h.nodes().find(node => node.props.id?.endsWith(suffix)) ?? assert.fail(suffix);
const review = h => h.nodes().find(node => node.type === "button" && node.props.children === "Review scope draft").props.onClick();
const click = (h, label) => h.nodes().find(node => node.type === "button" && node.props.children === label).props.onClick();
const word = (h, name, value) => input(h, `-${name}-wording`).props.onChange({ currentTarget: { value } });
const refs = (h, name, values) => input(h, `-${name}-references`).props.onChange({ currentTarget: { selectedOptions: values.map(value => ({ value })) } });
const html = h => renderToStaticMarkup(h.render());
const preview = h => h.nodes().find(node => node.type === "textarea" && node.props.readOnly)?.props.value;

test("an explicit invalid review marks the missing reference control and links fixed field guidance", () => {
  const h = scopeDraftHarness(capturedScopeDraftContext(proposalReport())); h.mount();
  try {
    input(h, "-population-wording").props.onChange({ currentTarget: { value: "Invented population awaiting references" } });
    review(h);
    const references = input(h, "-population-references");
    assert.equal(references.props["aria-invalid"], true, "review must identify the field the editor can correct");
    const html = renderToStaticMarkup(h.render());
    assert.ok(html.includes(`href="#${references.props.id}"`));
    assert.ok(references.props["aria-describedby"].includes("-population-references-error"));
  } finally { h.unmount(); }
});

test("missing wording and missing references identify separate controls without requiring unknown fields", () => {
  const h = scopeDraftHarness(capturedScopeDraftContext(proposalReport())); h.mount();
  try {
    assert.doesNotMatch(html(h), /aria-invalid|check wording|check references/);
    refs(h, "population", [`${proposalId(3)}:1`]); word(h, "period", "Invented interval"); review(h);
    assert.equal(input(h, "-population-wording").props["aria-invalid"], true);
    assert.equal(input(h, "-population-references").props["aria-invalid"], undefined);
    assert.equal(input(h, "-period-references").props["aria-invalid"], true);
    assert.equal(input(h, "-period-wording").props["aria-invalid"], undefined);
    assert.equal(input(h, "-selectionRationale-wording").props["aria-invalid"], undefined);
    const markup = html(h);
    for (const node of h.nodes().filter(node => node.props["aria-describedby"]))
      for (const id of node.props["aria-describedby"].split(" ")) assert.ok(markup.includes(`id="${id}"`), id);
    assert.equal(preview(h), undefined);
    word(h, "population", "Invented population"); refs(h, "period", [`${proposalId(3)}:2`]); review(h);
    assert.doesNotMatch(html(h), /aria-invalid|check wording|check references/);
    const candidate = JSON.parse(preview(h)); assert.equal(candidate.fields.selectionRationale, null);
    assert.equal(candidate.fields.population.wording, "Invented population");
    click(h, "Clear scope draft"); review(h);
    assert.ok(Object.values(JSON.parse(preview(h)).fields).every(value => value === null));
  } finally { h.unmount(); }
});

test("editing, clear and a changed capture retire held field hints and retained review actions", () => {
  const context = capturedScopeDraftContext(proposalReport()), codes = [], h = scopeDraftHarness(context, code => codes.push(code)); h.mount();
  try {
    word(h, "population", "Invented population"); review(h);
    const oldReview = h.nodes().find(node => node.type === "button" && node.props.children === "Review scope draft").props.onClick;
    word(h, "period", "Invented interval"); oldReview();
    assert.doesNotMatch(html(h), /aria-invalid|check references/);
    review(h); assert.match(html(h), /aria-invalid/);
    click(h, "Clear scope draft"); oldReview(); assert.doesNotMatch(html(h), /aria-invalid/);
    word(h, "population", "Invented population"); review(h);
    const context2 = { ...context, binding: { ...context.binding, captureId: proposalId(99) } };
    const markup = renderToStaticMarkup(h.render(context2));
    assert.doesNotMatch(markup, /aria-invalid|check references/);
    oldReview(); h.commit(); assert.doesNotMatch(html(h), /aria-invalid|check references/);
    assert.deepEqual(codes, []);
  } finally { h.unmount(); }
});

test("refused pasted JSON has generic guidance and never blames previously edited controls", () => {
  const codes = [], h = scopeDraftHarness(capturedScopeDraftContext(proposalReport()), code => codes.push(code)); h.mount();
  try {
    word(h, "population", "Invented population"); review(h); assert.match(html(h), /aria-invalid/);
    input(h, "-reopen-json").props.onChange({ currentTarget: { value: "PRIVATE_INVALID_JSON" } });
    click(h, "Reopen scope preparation");
    assert.doesNotMatch(html(h), /aria-invalid|check references|PRIVATE_INVALID_JSON<\/p>/);
    assert.match(html(h), /matching preparation JSON/); assert.equal(preview(h), undefined); assert.deepEqual(codes, []);
  } finally { h.unmount(); }
});

test("combined byte quota gives a global limit without false field errors or network effects", t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("No network port permitted"));
  const context = capturedScopeDraftContext(proposalReport()), claim = context.claims.find(row => row.id === proposalId(3));
  claim.evidence = Array.from({ length: 12 }, () => ({ ...claim.evidence[0] }));
  const codes = [], h = scopeDraftHarness(context, code => codes.push(code)); h.mount();
  try {
    for (const name of ["population", "period", "selectionRationale"]) {
      word(h, name, "\u0001".repeat(200) + "界".repeat(1000));
      refs(h, name, Array.from({ length: 12 }, (_, index) => `${claim.id}:${index + 1}`));
    }
    review(h); assert.match(html(h), /complete preparation exceeds the 16 KiB UTF-8 export limit/);
    assert.doesNotMatch(html(h), /aria-invalid|check references|check wording|<form/); assert.equal(preview(h), undefined);
    for (const name of ["population", "period", "selectionRationale"]) word(h, name, "Short invented wording");
    review(h); assert.equal(typeof preview(h), "string"); assert.doesNotMatch(html(h), /complete preparation exceeds/); assert.deepEqual(codes, []);
  } finally { h.unmount(); }
});

test("unmounted held-review callbacks cannot create feedback in a separate successor view", () => {
  const context = capturedScopeDraftContext(proposalReport()), prior = scopeDraftHarness(context); prior.mount();
  word(prior, "population", "Invented population");
  const oldReview = prior.nodes().find(node => node.type === "button" && node.props.children === "Review scope draft").props.onClick;
  prior.unmount(); const next = scopeDraftHarness(context); next.mount();
  try { oldReview(); assert.doesNotMatch(html(next), /aria-invalid|check references/); review(next); assert.equal(typeof preview(next), "string"); }
  finally { next.unmount(); }
});
