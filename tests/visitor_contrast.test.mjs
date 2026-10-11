import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

// Authored CSS data only: no Browser, DOM, HTTP, server or operational store.
// The glass calculations use explicitly named sRGB samples, not rendered pixels.
const nextRequire = createRequire(import.meta.resolve("next/package.json"));
const postcss = nextRequire("postcss");
const css = postcss.parse(readFileSync(process.env.TF_TEST_CONTRAST_CSS ?? new URL("../app/globals.css", import.meta.url), "utf8"));
const contrastMedia = "(prefers-contrast: more), (prefers-reduced-transparency: reduce)";

function mediaOf(rule) {
  const names = [];
  for (let parent = rule.parent; parent; parent = parent.parent)
    if (parent.type === "atrule") names.unshift(`@${parent.name} ${parent.params}`);
  return names.join(";");
}
function properties(selector, media = "") {
  const result = new Map();
  css.walkRules(rule => {
    if (!rule.selectors.includes(selector) || mediaOf(rule) !== (media ? `@media ${media}` : "")) return;
    for (const node of rule.nodes) if (node.type === "decl") {
      const previous = result.get(node.prop);
      if (!previous?.important || node.important) result.set(node.prop, node);
    }
  });
  return result;
}
function value(selector, property, media = "") {
  const declaration = properties(selector, media).get(property);
  assert.ok(declaration, `${selector} ${property} in ${media || "ordinary CSS"}`);
  return declaration.value;
}
function rgb(text) {
  if (/^var\(--[a-z-]+\)$/.test(text)) return rgb(value(":root", text.slice(4, -1)));
  assert.match(text, /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i, `selected opaque color: ${text}`);
  const hex = text.length === 4 ? text.slice(1).split("").map(x => x + x).join("") : text.slice(1);
  return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
}
function luminance(color) {
  const channels = color.map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}
function contrast(a, b) {
  const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (high + .05) / (low + .05);
}
function over(top, bottom) {
  return bottom.map((x, i) => top[i] * top[3] + x * (1 - top[3]));
}
function glassSamples() {
  // The fixed four comma-rgba declarations are this card's three gradient stops
  // and its base layer. Format changes require a deliberate test-model update.
  const background = value(".feature-card", "background");
  const layers = [...background.matchAll(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([.\d]+)\)/g)]
    .map(match => [+match[1] / 255, +match[2] / 255, +match[3] / 255, +match[4]]);
  assert.equal(layers.length, 4, "selected fixed card paint model");
  const base = over(layers[3], rgb(value(":root", "--paper")));
  const stops = layers.slice(0, 3);
  const samples = [];
  for (let i = 0; i < stops.length - 1; i++) for (let step = 0; step <= 50; step++) {
    const t = step / 50;
    // Premultiplied sRGB alpha interpolation. This is an explicit mathematical
    // model, not a claim about all gradient spaces or browser compositing.
    const alpha = stops[i][3] * (1 - t) + stops[i + 1][3] * t;
    const mixed = [0, 1, 2].map(channel =>
      (stops[i][channel] * stops[i][3] * (1 - t) + stops[i + 1][channel] * stops[i + 1][3] * t) / alpha);
    samples.push(over([...mixed, alpha], base));
  }
  return samples;
}

test("contrast arithmetic preserves exact thresholds instead of rounding near misses", () => {
  assert.equal(contrast(rgb("#000"), rgb("#fff")), 21);
  assert.equal(contrast(rgb("#fff"), rgb("#fff")), 1);
  assert.equal(contrast(rgb("#123456"), rgb("#abcdef")), contrast(rgb("#abcdef"), rgb("#123456")));
  const original = contrast(rgb("#a55539"), rgb("#e8ede3"));
  assert.ok(original > 4.45 && original < 4.5, "the original 4.459953 near miss really fails 4.5");
});
test("hovered ordinary-size action text remains readable on the solid green accessibility fallback", () => {
  const actual = contrast(rgb(value(".arrow-link:hover", "color")), rgb(value(".feature-card", "background", contrastMedia)));
  assert.ok(actual >= 4.5, `actual action/fallback contrast ${actual}`);
});
for (const selector of [".arrow-link:hover", ".info-band p"])
  test(`${selector} meets 4.5 in the declared sRGB glass model`, () => {
    assert.equal(value(".info-band", "background"), value(".feature-card", "background"), "these selected surfaces share the same authored paint");
    const color = rgb(value(selector, "color"));
    const minimum = Math.min(...glassSamples().map(background => contrast(color, background)));
    assert.ok(minimum >= 4.5, `${selector}: minimum modeled contrast ${minimum}`);
  });
test("keyboard focus has two external contrasting bands with independently sufficient widths", () => {
  const outline = value(":focus-visible", "outline").match(/^(\d+)px solid (#[0-9a-f]+|var\(--[a-z-]+\))$/i);
  const shadow = value(":focus-visible", "box-shadow").match(/^0 0 0 (\d+)px (#[0-9a-f]+|var\(--[a-z-]+\))$/i);
  assert.ok(outline && shadow, "a real outline and a second visible band are required");
  const offset = parseFloat(value(":focus-visible", "outline-offset"));
  assert.ok(offset >= 0, "focus must be external to the control");
  assert.ok(+outline[1] >= 2 && +shadow[1] - offset - +outline[1] >= 2, "each band is at least 2px");
  assert.ok(contrast(rgb(outline[2]), rgb(shadow[2])) >= 9, "W3C C40 two-color contrast bound");
});
test("focused shadow survives the more specific glass-control shadows", () => {
  const focus = properties(":focus-visible").get("box-shadow");
  assert.ok(focus?.important, "the focus band wins over ordinary higher-specificity component shadows");
  css.walkRules(rule => {
    if (mediaOf(rule) || rule.selector.includes(":focus-visible")) return;
    for (const decl of rule.nodes) if (decl.type === "decl" && decl.prop === "box-shadow")
      assert.ok(!decl.important, `ordinary important shadow needs its own focus resolution: ${rule.selector}`);
  });
});
test("forced colors retains a system outline when box shadows are suppressed", () => {
  const focus = properties(":focus-visible", "(forced-colors: active)");
  assert.match(focus.get("outline")?.value ?? "", /^(?:[2-9]|\d{2,})px solid (?:Highlight|CanvasText)$/);
  assert.equal(focus.get("box-shadow")?.value, "none");
  assert.ok(focus.get("box-shadow")?.important, "system mode overrides the ordinary important focus shadow");
  assert.ok(parseFloat(focus.get("outline-offset")?.value ?? "-1") >= 0);
});
