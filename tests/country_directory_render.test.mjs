import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";

// Render the actual page and all of its actual TSX dependencies in process.
// No Browser, HTTP, DOM or generated app code is accessed.
const page = loadTsx(new URL("../app/countries/page.tsx", import.meta.url)).default;
const render = async (query) => renderToStaticMarkup(await page({ searchParams: Promise.resolve(query) }));

test("empty, ordinary and full-width country searches show the sample with its limits", async () => {
  for (const query of [{}, { q: " norWAY " }, { q: "Ｎｏｒｗａｙ" }]) {
    const html = await render(query);
    assert.ok(html.includes('href="/countries/norway"'));
    assert.ok(html.includes("Demonstration only"));
    assert.ok(html.includes('maxLength="80"'));
    assert.ok(html.includes('aria-describedby="country-search-guidance"'));
  }
});
test("duplicate, control and overlong inputs cannot become an empty successful search", async () => {
  for (const q of [["Norway", "other"], "Norway\0", "Norway" + " ".repeat(81), "\ufdfa".repeat(5)]) {
    const html = await render({ q });
    assert.ok(html.includes("Check your search"));
    assert.ok(!html.includes('href="/countries/norway"'));
    assert.ok(html.includes('aria-invalid="true"'));
    assert.ok(html.includes('href="/countries"')); 
  }
});
test("missing names have an escaped query and a direct clear action", async () => {
  const html = await render({ q: '<script>alert("sample")</script>' });
  assert.ok(html.includes("No sample country matches"));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("Clear search"));
});

test("the Norwegian country alias already supported by issue discovery also reaches the country overview", async () => {
  for (const q of ["Norge", " norge ", "Ｎｏｒｇｅ"]) {
    const html = await render({ q });
    assert.ok(html.includes('href="/countries/norway"'), q);
    assert.ok(html.includes("Demonstration only"));
    assert.ok(!html.includes("No sample country matches"));
  }
});
