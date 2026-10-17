import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { feedReport } from "./helpers/feed_discovery_fixture.mjs";
const View = loadTsx(new URL("../src/feed-discovery-view.tsx", import.meta.url)).FeedDiscoveryView;
const render = input => renderToStaticMarkup(View({ input }));

test("actual discovery view exposes both metadata vintages, dates, held units and rolloff limits", () => {
  const html = render(feedReport());
  for (const text of ["Invented earlier title", "Invented revised title", "Feed metadata revised", "First observed does not mean newly published",
    "Another page is advertised but has not been read", "entry_link_invalid_or_ambiguous", "Its current entry is held",
    "does not establish withdrawal or deletion", "Mon, 01 Jan 2001", "Feed modification date text (unparsed)", "Not supplied"])
    assert.ok(html.includes(text), text);
  assert.match(html, /dateTime="2026-10-14T11:00:00.000000Z"/i);
  assert.match(html, /dateTime="2026-10-14T12:00:00.000000Z"/i);
  assert.equal((html.match(/<h2/g) ?? []).length, 1); assert.ok((html.match(/<details/g) ?? []).length >= 4);
});
test("display is passive and does not open candidate or next-page addresses", t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("No request permitted"));
  const html = render(feedReport());
  assert.doesNotMatch(html, /href=|<form|<input|<button|<textarea|<script|127\.0\.0\.1/);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
});
test("unavailable cannot masquerade as an empty successful report", () => {
  const unavailable = render({ ...feedReport(), secret: "PRIVATE_PAYLOAD" });
  assert.match(unavailable, /Discovery report unavailable/); assert.doesNotMatch(unavailable, /PRIVATE_PAYLOAD|Invented revised title|Source bytes:/);
  const value = feedReport(); value.current.entries = []; value.current.held = [];
  value.previous = null; value.changes = []; value.not_reobserved = []; value.source_bytes_changed = null;
  const empty = render(value); assert.match(empty, /No candidate leads in this supplied window/);
  assert.match(empty, /No earlier window supplied/); assert.doesNotMatch(empty, /report unavailable/);
});
test("hostile feed metadata remains escaped in current and earlier rendering", () => {
  const value = feedReport(), hostile = "<script>UNTRUSTED_TITLE</script>";
  value.current.entries[0].title = hostile; value.changes[0].current.title = hostile;
  const html = render(value); assert.match(html, /&lt;script&gt;UNTRUSTED_TITLE&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script/);
});
