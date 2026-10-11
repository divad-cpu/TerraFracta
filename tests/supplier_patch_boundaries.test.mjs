import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// Exercise the installed consumers, not a parallel direct dependency or mock.
const require = createRequire(import.meta.url);
const nextRequire = createRequire(require.resolve("next/package.json"));
const sharp = nextRequire("sharp");
const postcss = nextRequire("postcss");
const cssRequire = createRequire(nextRequire.resolve("postcss/package.json"));
const { SourceMapConsumer, SourceMapGenerator, SourceNode } = cssRequire("source-map-js");

function basic(source) {
  return { version: 3, sources: [source], names: [], mappings: "AAAA", sourcesContent: ["x"] };
}
function indexed(line = 0, column = 0, map = basic("a.css")) {
  return { version: 3, sections: [{ offset: { line, column }, map }] };
}

test("Next and PostCSS resolve the supplier patch versions", () => {
  assert.equal(sharp.versions.sharp, "0.35.5");
  assert.equal(cssRequire("source-map-js/package.json").version, "1.2.2");
});

test("native PNG encode, nearest resize and raw decode preserve synthetic pixels", async () => {
  const pixels = Buffer.from([255, 0, 0, 0, 255, 0]);
  const png = await sharp(pixels, { raw: { width: 2, height: 1, channels: 3 } }).png().toBuffer();
  assert.equal((await sharp(png).metadata()).format, "png");
  const { data, info } = await sharp(png).resize(4, 2, { kernel: "nearest" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height, info.channels], [4, 2, 3]);
  const row = [255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 0];
  assert.deepEqual([...data], [...row, ...row]);
});

test("native image parser rejects an ordinary invalid buffer", async () => {
  await assert.rejects(sharp(Buffer.from("synthetic non-image")).metadata(), /unsupported image format/i);
});

test("ordinary source maps preserve source text and original positions", () => {
  const generator = new SourceMapGenerator({ file: "out.css" });
  generator.addMapping({ generated: { line: 1, column: 0 }, original: { line: 3, column: 2 }, source: "input.css" });
  generator.setSourceContent("input.css", "\n\n  .sample { color: red; }");
  const consumer = new SourceMapConsumer(generator.toJSON());
  assert.deepEqual(consumer.originalPositionFor({ line: 1, column: 0 }), { source: "input.css", line: 3, column: 2, name: null });
  assert.equal(consumer.sourceContentFor("input.css"), "\n\n  .sample { color: red; }");
  const result = SourceNode.fromStringWithSourceMap(".sample { color: red; }", consumer).toStringWithSourceMap({ file: "again.css" });
  assert.equal(result.code, ".sample { color: red; }");
  assert.equal(new SourceMapConsumer(result.map.toJSON()).originalPositionFor({ line: 1, column: 0 }).line, 3);
});

test("small ordered indexed sections retain both original sources", () => {
  const consumer = new SourceMapConsumer({ version: 3, sections: [
    { offset: { line: 0, column: 0 }, map: basic("first.css") },
    { offset: { line: 2, column: 0 }, map: basic("second.css") },
  ] });
  assert.equal(consumer.originalPositionFor({ line: 1, column: 1 }).source, "first.css");
  assert.equal(consumer.originalPositionFor({ line: 3, column: 1 }).source, "second.css");
});

test("indexed maps reject invalid offset types before consuming them", () => {
  for (const invalid of [-1, 0.5, Infinity, NaN, "0", null]) {
    assert.throws(() => new SourceMapConsumer(indexed(invalid)), /non-negative integers/);
    assert.throws(() => new SourceMapConsumer(indexed(0, invalid)), /non-negative integers/);
  }
});

test("patched indexed maps bound direct and nested total line offsets", () => {
  assert.throws(() => new SourceMapConsumer(indexed(10_000_001)), /must not exceed/);
  assert.throws(() => new SourceMapConsumer(indexed(6_000_000, 0, indexed(6_000_000))), /must not exceed/);
});

test("PostCSS consumes its actual patched map dependency during a CSS transform", async () => {
  const original = ".sample { color: red; }";
  const previous = new SourceMapGenerator({ file: "input.css" });
  previous.addMapping({ generated: { line: 1, column: 0 }, original: { line: 2, column: 0 }, source: "original.css" });
  previous.setSourceContent("original.css", "\n" + original);
  const change = { postcssPlugin: "synthetic-color", Declaration(decl) { if (decl.prop === "color") decl.value = "blue"; } };
  const result = await postcss([change]).process(original, { from: "input.css", to: "output.css", map: { prev: previous.toJSON(), inline: false, annotation: false } });
  assert.equal(result.css, ".sample { color: blue; }");
  const consumer = new SourceMapConsumer(result.map.toJSON());
  assert.equal(consumer.originalPositionFor({ line: 1, column: 0 }).line, 2);
  assert.equal(consumer.sourceContentFor("original.css"), "\n" + original);
});
