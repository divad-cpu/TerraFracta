import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Exact authored pages/components rendered in process. No HTTP, DOM, Browser,
// server, private store or image; only Next pathname context is substituted.
let pathname = "/";
const cache = new Map();
function load(relative) {
  const source = new URL(relative, import.meta.url);
  if (cache.has(source.href)) return cache.get(source.href);
  const exports = {}, native = createRequire(source);
  const compiled = ts.transpileModule(readFileSync(source, "utf8"), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const require = name => {
    if (name === "next/navigation") return { usePathname: () => pathname };
    if (name.endsWith(".css")) return {};
    if (name.startsWith(".")) {
      const full = new URL(name, source);
      if (full.pathname.endsWith(".tsx") || existsSync(new URL(full.href + ".tsx")))
        return load(full.pathname.endsWith(".tsx") ? full.href : full.href + ".tsx");
      if (existsSync(new URL(full.href + ".ts"))) return native(name + ".ts");
    }
    return native(name);
  };
  new Function("require", "exports", compiled)(require, exports);
  cache.set(source.href, exports); return exports;
}
const render = element => renderToStaticMarkup(element);
const issues = async query => render(await load("../app/issues/page.tsx").default({ searchParams: Promise.resolve(query) }));

test("actual issue directory preserves search selectors, result counts and illustrative status", async () => {
  const html = await issues({ q: "Norway housing", topic: "housing" });
  for (const text of ['action="/issues"', 'method="get"', 'name="q"', 'name="topic"',
    "1 illustrative case found", "Verified public dossiers: 0", "Demonstration only", "Not performed",
    'href="/countries/norway/issues/housing-costs"']) assert.ok(html.includes(text), text);
  assert.equal((html.match(/<h1>/g) ?? []).length, 1);
  assert.ok(html.includes('aria-describedby="issue-search-help"'));
});
test("actual empty and invalid searches withhold cards, escape text and offer a recovery path", async () => {
  const empty = await issues({ q: '<script>private-canary</script>' });
  assert.ok(empty.includes("No case matches")); assert.ok(empty.includes("&lt;script&gt;"));
  assert.ok(!empty.includes("<script>")); assert.ok(!empty.includes("visitor-issue-card"));
  const invalid = await issues({ q: ["Norway"], source: "private-canary" });
  assert.ok(invalid.includes("Check your search")); assert.ok(!invalid.includes("private-canary"));
  assert.ok(!invalid.includes("visitor-issue-card")); assert.ok(invalid.includes('href="/issues"'));
});
test("actual navigation has one exact or parent location and keeps mobile links in semantic nav", () => {
  const Navigation = load("../app/site-navigation.tsx").SiteNavigation;
  for (const [route, current] of [["/issues", "page"], ["/countries/norway/issues/housing-costs", "location"], ["/about", "page"]]) {
    pathname = route; const html = render(createElement(Navigation));
    assert.equal((html.match(/aria-current=/g) ?? []).length, 1);
    assert.ok(html.includes(`aria-current="${current}"`));
    for (const href of ["/issues", "/countries", "/methodology", "/sources", "/about"])
      assert.ok(html.includes(`href="${href}"`));
    assert.ok(!html.includes("<button"));
  }
  pathname = "/countries-other";
  assert.ok(!render(createElement(Navigation)).includes("aria-current="));
});
test("actual dossier exposes sections, definitions and exact correction links without claiming source evidence", () => {
  const html = render(createElement(load("../app/countries/norway/issues/housing-costs/page.tsx").default));
  for (const section of ["problem", "response", "uncertainty", "sources"])
    assert.ok(html.includes(`id="${section}"`) && html.includes(`href="#${section}"`), section);
  for (const section of ["problem", "response", "uncertainty", "sources"])
    assert.ok(html.includes(`href="/corrections?section=${section}"`));
  for (const text of ["No verified conclusions", "Definitions and comparability", "Not performed for this sample", "Illustrative percentages"])
    assert.ok(html.includes(text), text);
  assert.equal((html.match(/<h1>/g) ?? []).length, 1);
});
test("actual correction page retains allowed section and exact return link, malformed selectors withhold editor", async () => {
  const page = load("../app/corrections/page.tsx").default;
  for (const section of ["problem", "response", "uncertainty", "sources"]) {
    const html = render(await page({ searchParams: Promise.resolve({ section }) }));
    assert.ok(html.includes(`href="/countries/norway/issues/housing-costs#${section}"`));
    assert.ok(html.includes("Affected section")); assert.ok(html.includes("Nothing is sent or saved"));
    assert.ok(!html.includes('type="submit"'));
  }
  for (const query of [{ section: ["problem"] }, { section: "../private-canary" }, { path: "private-canary" }]) {
    const html = render(await page({ searchParams: Promise.resolve(query) }));
    assert.ok(html.includes("Check the draft link")); assert.ok(!html.includes("textarea"));
    assert.ok(!html.includes("private-canary"));
  }
});

test("the existing source section joins the unsent correction exercise with an exact return target", async () => {
  const dossier = render(createElement(load("../app/countries/norway/issues/housing-costs/page.tsx").default));
  assert.ok(dossier.includes('href="/corrections?section=sources"'));
  const page = load("../app/corrections/page.tsx").default;
  const html = render(await page({ searchParams: Promise.resolve({ section: "sources" }) }));
  assert.ok(html.includes("Selected section:"));
  assert.ok(html.includes("Evidence and sources"));
  assert.ok(html.includes("Affected section"));
  assert.ok(html.includes('href="/countries/norway/issues/housing-costs#sources"'));
  assert.ok(html.includes("Nothing is sent or saved"));
  assert.ok(!html.includes('type="submit"'));
});
test("actual section change remounts only the illustrative editor and does not replace connected targets", () => {
  const { CorrectionDraft } = load("../app/corrections/draft-form.tsx");
  assert.notEqual(CorrectionDraft({ sampleSection: "problem" }).key, CorrectionDraft({ sampleSection: "response" }).key);
  const html = render(createElement(CorrectionDraft, { sampleSection: "problem" }));
  assert.ok(html.includes("The problem")); assert.ok(!html.includes("Publication revision"));
});
test("actual error UI never observes private diagnostics and its retry callback is explicit", () => {
  const Page = load("../app/error.tsx").default;
  const error = Object.defineProperties({}, { message: { get() { assert.fail("Error message read"); } }, digest: { get() { assert.fail("Private digest read"); } } });
  let retries = 0; const element = Page({ error, retry: () => retries++ });
  const html = render(element); assert.ok(html.includes("temporarily unavailable"));
  assert.equal(retries, 0);
  const walk = item => Array.isArray(item) ? item.flatMap(walk) : item?.props ? [item, ...walk(item.props.children)] : [];
  walk(element).find(item => item.type === "button").props.onClick(); assert.equal(retries, 1);
  assert.ok(!html.includes("digest"));
});
test("actual missing-page and loading states use honest availability and usable navigation", () => {
  const absent = render(createElement(load("../app/not-found.tsx").default));
  assert.ok(absent.includes('href="/issues"')); assert.ok(absent.includes("not evidence"));
  const loading = render(createElement(load("../app/loading.tsx").default));
  assert.ok(loading.includes('aria-busy="true"')); assert.ok(loading.includes('role="status"'));
  assert.ok(!loading.includes("verified"));
});
test("actual home-to-case journey has labelled search, common navigation and explicit prototype limits", () => {
  pathname = "/";
  const Home = load("../app/page.tsx").default;
  const Layout = load("../app/layout.tsx").default;
  const html = render(createElement(Layout, { children: createElement(Home) }));
  for (const text of ['href="#main"', 'id="main"', 'lang="en"', 'action="/issues"',
    'for="home-query"', 'id="home-query"', 'name="q"', 'maxLength="80"',
    'href="/about"', 'href="/countries/norway/issues/housing-costs"', "Prototype content is illustrative"])
    assert.ok(html.includes(text), text);
  assert.equal((html.match(/<h1>/g) ?? []).length, 1);
  assert.ok(!html.includes('aria-current="page"'));
  assert.ok(!html.includes("verified updates today"));
  assert.equal(load("../app/layout.tsx").metadata.robots.index, false);
});
test("actual purpose page shows owner-supplied contact while funding, submissions and country evidence stay explicit", () => {
  const about = render(createElement(load("../app/about/page.tsx").default));
  assert.ok(about.includes("No real dossier is published here"));
  assert.ok(about.includes("Responsible organization:</strong> Fideli Solutions."));
  assert.ok(about.includes('<a href="mailto:david@fideli.no">david@fideli.no</a>'));
  assert.equal((about.match(/href="mailto:/g) ?? []).length, 1);
  assert.ok(about.includes("opens your email app"));
  assert.ok(about.includes("Funding:</strong> Disclosure is pending."));
  assert.ok(about.includes("this prototype has no submission service"));
  assert.ok(about.includes('href="/corrections"') && about.includes("unsent correction draft"));
  assert.ok(!about.includes("<form") && !about.includes('type="submit"'));
  const country = render(createElement(load("../app/countries/norway/page.tsx").default));
  assert.ok(country.includes("0 verified")); assert.ok(country.includes("not been qualified for display"));
  assert.ok(!country.includes("has not passed the review"));
});
