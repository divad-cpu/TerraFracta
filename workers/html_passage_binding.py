"""Bounded supplied HTML to selected private parsed text, never rendered visibility.

Original HTML, exact outer-element spans and derived text have distinct hashes.
The independent recipe/identity assertions are not source, language, rights,
support or publication qualification. No HTTP/plain-text/custody contract is
widened, and no file, URL, CSS, script, provider or browser is opened/executed.
"""
from dataclasses import dataclass, field
from datetime import datetime, timezone
from hashlib import sha256
from html import unescape
from html.entities import html5
from html.parser import HTMLParser
import json
import re

from workers.dispatch_input_snapshot import freeze_input, thaw_input
from workers.public_source_url import public_https_source_url
from workers.prose_passage_selection import (
    MAX_PASSAGES, MAX_PASSAGE_BYTES, MAX_CAPTURE_TEXT_BYTES,
    Passage, PassageSnapshot, _validate as validate_snapshot,
)

MAX_HTML_BYTES = 64 * 1024
MAX_HTML_DEPTH = 64
MAX_HTML_ELEMENTS = 2048
ADAPTER_IDENTITY = 'terrafracta-selected-html-parsed-text/v1'
PARSER_IDENTITY = 'stdlib.html.parser.HTMLParser:convert_charrefs=False'
VOID = frozenset('area base br col embed hr img input link meta param source track wbr'.split())
EXCLUDED = frozenset('script style template noscript head title iframe object embed svg math canvas video audio picture source track link meta input button select textarea form'.split())
TABLE = frozenset('table thead tbody tfoot tr td th caption col colgroup'.split())
BLOCK = frozenset('article section main div p h1 h2 h3 h4 h5 h6 ul ol li blockquote dl dt dd header footer nav address'.split())
INLINE = frozenset('span a b strong i em u s small sub sup mark abbr cite q time data code'.split())
NAME = re.compile(r'[A-Za-z][A-Za-z0-9:-]*')
ATTR = re.compile(r'[A-Za-z_:][A-Za-z0-9_.:-]*')
IDENTITY = re.compile(r'[A-Za-z][A-Za-z0-9_.:-]{0,119}')


class HtmlPassageError(ValueError):
    """Curated all-or-nothing refusal; never embeds source or parser details."""


@dataclass(frozen=True)
class HtmlDocumentReceipt:
    source_key: str
    item_key: str
    source_version_id: str
    source_url: str
    content_sha256: str
    retrieved_at: datetime
    media_type: str = 'text/html'
    encoding: str = 'utf-8'


@dataclass(frozen=True)
class HtmlPassageBinding:
    source_key: str
    item_key: str
    source_version_id: str
    source_url: str
    content_sha256: str
    mapping_sha256: str
    language_code: str
    retrieved_at: datetime


@dataclass(frozen=True)
class HtmlElementSelection:
    locator: str
    element_id: str


@dataclass(frozen=True)
class HtmlSelectionMap:
    source_version_id: str
    content_sha256: str
    mapping_sha256: str
    language_code: str
    selections: tuple[HtmlElementSelection, ...]


@dataclass(frozen=True)
class HtmlSelectedSpan:
    locator: str
    element_id: str
    tag: str
    start: int
    end: int
    raw_sha256: str
    derived_text_sha256: str


@dataclass(frozen=True)
class BoundHtmlPassages:
    document: HtmlDocumentReceipt
    snapshot: PassageSnapshot
    spans: tuple[HtmlSelectedSpan, ...]
    derivation_manifest_raw: bytes = field(repr=False)
    derivation_manifest_sha256: str
    adapter_identity: str = ADAPTER_IDENTITY
    parser_identity: str = PARSER_IDENTITY
    coverage: str = 'selected_elements_parsed_text_only'
    evidence_state: str = 'offline_html_derivation_only_not_rendered_or_qualified'


def _plain(value, maximum):
    return (type(value) is str and 1 <= len(value) <= maximum
            and value == value.strip() and all(ord(c) >= 32 for c in value))


def _digest(value):
    return type(value) is str and re.fullmatch('[a-f0-9]{64}', value) is not None


def _utc(value):
    return type(value) is datetime and value.tzinfo is not None and value.utcoffset() == timezone.utc.utcoffset(value)


def _start_attributes(raw, tag, parsed):
    """Close tolerant-parser attribute syntax; do not interpret links or CSS."""
    match = NAME.match(raw, 1)
    if match is None or match.group().lower() != tag:
        raise ValueError
    at = match.end(); names = []
    while True:
        before = at
        while at < len(raw) and raw[at] in ' \t\r\n\f':
            at += 1
        if raw[at:] in ('>', '/>'):
            break
        if at == before:
            raise ValueError
        name = ATTR.match(raw, at)
        if name is None:
            raise ValueError
        names.append(name.group().lower()); at = name.end(); after_name = at
        while at < len(raw) and raw[at] in ' \t\r\n\f':
            at += 1
        if at < len(raw) and raw[at] == '=':
            at += 1
            while at < len(raw) and raw[at] in ' \t\r\n\f':
                at += 1
            if at >= len(raw):
                raise ValueError
            if raw[at] in '\"\'':
                quote = raw[at]; end = raw.find(quote, at + 1)
                if end < 0 or '<' in raw[at + 1:end]:
                    raise ValueError
                at = end + 1
            else:
                value = re.match(r'[^\s\"\'=<>`]+', raw[at:])
                if value is None:
                    raise ValueError
                at += len(value.group())
        else:
            at = after_name
    if len(set(names)) != len(names) or names != [name for name, _ in parsed]:
        raise ValueError
    return dict(parsed)


class _SelectedHtml(HTMLParser):
    def __init__(self, text, raw, selections):
        super().__init__(convert_charrefs=False)
        self.text = text; self.raw = raw; self.selections = selections
        self.wanted = {selection.element_id: selection for selection in selections}
        self.lines = [0] + [index + 1 for index, char in enumerate(text) if char == '\n']
        self.bytes = [0]
        for char in text:
            self.bytes.append(self.bytes[-1] + len(char.encode('utf8')))
        self.cursor = 0; self.stack = []; self.ids = set(); self.elements = 0
        self.active = None; self.parts = []; self.rows = []; self.declaration = False

    def _position(self):
        line, column = self.getpos()
        return self.lines[line - 1] + column

    def _consume(self, raw):
        start = self._position(); end = start + len(raw)
        if start != self.cursor or self.text[start:end] != raw:
            raise ValueError
        self.cursor = end
        return start, end

    def _boundary(self, newline=False):
        if self.active is not None:
            self.parts.append('\n' if newline else ' ')

    def _begin(self, tag, attrs, standalone):
        raw = self.get_starttag_text(); start, _ = self._consume(raw)
        attrs = _start_attributes(raw, tag, attrs)
        self.elements += 1
        if self.elements > MAX_HTML_ELEMENTS or len(self.stack) + 1 > MAX_HTML_DEPTH:
            raise ValueError
        if standalone and tag not in VOID:
            raise ValueError
        identity = attrs.get('id')
        if 'id' in attrs:
            if type(identity) is not str or IDENTITY.fullmatch(identity) is None or identity in self.ids:
                raise ValueError
            self.ids.add(identity)
        parent_excluded = bool(self.stack and self.stack[-1][1])
        selected = self.wanted.get(identity)
        excluded = parent_excluded or tag in EXCLUDED or 'hidden' in attrs or attrs.get('aria-hidden') == 'true'
        if selected is not None:
            if self.active is not None or excluded or tag in VOID:
                raise ValueError
            self.active = (selected, tag, self.bytes[start]); self.parts = []
        if self.active is not None and not parent_excluded:
            if tag in TABLE or (tag not in BLOCK | INLINE | VOID | EXCLUDED):
                raise ValueError
            if 'style' in attrs or ('aria-hidden' in attrs and attrs['aria-hidden'] not in ('true', 'false')):
                raise ValueError
            if excluded:
                self._boundary()
            elif tag in BLOCK or tag in ('br', 'hr'):
                self._boundary(newline=True)
        if tag not in VOID:
            self.stack.append((tag, excluded, selected is not None))

    def handle_starttag(self, tag, attrs):
        self._begin(tag, attrs, False)

    def handle_startendtag(self, tag, attrs):
        self._begin(tag, attrs, True)

    def handle_endtag(self, tag):
        at = self._position()
        end = re.match(r'</([A-Za-z][A-Za-z0-9:-]*)[ \t\r\n\f]*>', self.text[at:])
        if end is None or end.group(1).lower() != tag:
            raise ValueError
        _, finish = self._consume(end.group())
        if not self.stack or self.stack[-1][0] != tag:
            raise ValueError
        _, excluded, selected = self.stack.pop()
        if self.active is not None:
            if excluded:
                self._boundary()
            elif tag in BLOCK:
                self._boundary(newline=True)
        if selected:
            selection, selected_tag, start = self.active
            text = ''.join(self.parts)
            text = re.sub(' *\n *', '\n', re.sub(' +', ' ', text))
            text = re.sub('\n+', '\n', text).strip(' \n')
            if not text:
                raise ValueError
            body = text.encode('utf8'); stop = self.bytes[finish]
            if len(body) > MAX_PASSAGE_BYTES:
                raise ValueError
            self.rows.append((selection, text, HtmlSelectedSpan(selection.locator, selection.element_id,
                selected_tag, start, stop, sha256(self.raw[start:stop]).hexdigest(), sha256(body).hexdigest())))
            self.active = None; self.parts = []

    def handle_data(self, data):
        self._consume(data)
        excluded = bool(self.stack and self.stack[-1][1])
        if not excluded and ('<' in data or '&' in data):
            raise ValueError
        if self.active is not None and not excluded:
            self.parts.append(re.sub('[ \t\r\n\f]+', ' ', data))

    def _reference(self, raw, text):
        self._consume(raw)
        if self.active is not None and not (self.stack and self.stack[-1][1]):
            self.parts.append(re.sub('[ \t\r\n\f]+', ' ', text))

    def handle_entityref(self, name):
        raw = '&' + name + ';'
        if name + ';' not in html5:
            raise ValueError
        self._reference(raw, html5[name + ';'])

    def handle_charref(self, name):
        value = int(name[1:], 16) if name[:1].lower() == 'x' else int(name, 10)
        if (not 0 < value <= 0x10ffff or 0xd800 <= value <= 0xdfff
                or value < 32 and value not in (9, 10, 13) or 127 <= value <= 159
                or 0xfdd0 <= value <= 0xfdef or value & 0xffff in (0xfffe, 0xffff)):
            raise ValueError
        raw = '&#' + name + ';'
        self._reference(raw, unescape(raw))

    def handle_comment(self, data):
        self._consume('<!--' + data + '-->')
        if '--' in data:
            raise ValueError
        self._boundary()

    def handle_decl(self, decl):
        if self.declaration or self.elements or decl.lower() != 'doctype html':
            raise ValueError
        self._consume('<!' + decl + '>'); self.declaration = True

    def handle_pi(self, data):
        raise ValueError

    def unknown_decl(self, data):
        raise ValueError


def bind_html_passages(raw: bytes, document: HtmlDocumentReceipt, *, binding: HtmlPassageBinding,
        mapping: HtmlSelectionMap, observed_at: datetime) -> BoundHtmlPassages:
    """Independently bind a strict balanced HTML profile, all selected IDs or none.

    ASCII source whitespace collapses to spaces; block/br boundaries become one
    LF; valid semicolon character references decode without Unicode normalization.
    Script/style/template/noscript and embedded/form/head/hidden subtrees are
    omitted with a token boundary. Selected tables, unknown markup and inline CSS
    refuse. External CSS/classes are not evaluated: this is never rendered text.
    Source order must match the supplied selection order. No baseline is chosen.
    """
    try:
        raw, document, binding, mapping, observed_at = thaw_input(freeze_input(
            (raw, document, binding, mapping, observed_at),
            (HtmlDocumentReceipt, HtmlPassageBinding, HtmlSelectionMap, HtmlElementSelection)))
        if (type(raw) is not bytes or not 1 <= len(raw) <= MAX_HTML_BYTES
                or type(document) is not HtmlDocumentReceipt or type(binding) is not HtmlPassageBinding
                or type(mapping) is not HtmlSelectionMap or not _utc(observed_at)
                or not _utc(document.retrieved_at) or document.retrieved_at > observed_at
                or not _utc(binding.retrieved_at) or document.media_type != 'text/html' or document.encoding != 'utf-8'
                or not public_https_source_url(document.source_url)
                or not all(_plain(getattr(document, key), 120) for key in ('source_key', 'item_key', 'source_version_id'))
                or not _digest(document.content_sha256) or sha256(raw).hexdigest() != document.content_sha256
                or not _digest(binding.mapping_sha256) or type(binding.language_code) is not str
                or re.fullmatch(r'[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?', binding.language_code) is None):
            raise ValueError
        if (any(type(getattr(binding, key)) is not str or getattr(document, key) != getattr(binding, key)
                for key in ('source_key', 'item_key', 'source_version_id', 'source_url', 'content_sha256'))
                or document.retrieved_at != binding.retrieved_at
                or any(type(getattr(mapping, key)) is not str or getattr(mapping, key) != getattr(binding, key)
                for key in ('source_version_id', 'content_sha256', 'mapping_sha256', 'language_code'))
                or type(mapping.selections) is not tuple or not 1 <= len(mapping.selections) <= MAX_PASSAGES):
            raise ValueError
        locators = set(); ids = set()
        for selection in mapping.selections:
            if (type(selection) is not HtmlElementSelection or not _plain(selection.locator, 200)
                    or type(selection.element_id) is not str or IDENTITY.fullmatch(selection.element_id) is None
                    or selection.locator in locators or selection.element_id in ids):
                raise ValueError
            locators.add(selection.locator); ids.add(selection.element_id)
        text = raw.decode('utf8', 'strict')
        if any(ord(char) < 32 and char not in '\t\r\n\f' or ord(char) == 127 for char in text):
            raise ValueError
        parser = _SelectedHtml(text, raw, mapping.selections)
        try:
            parser.feed(text); parser.close()
        except Exception:
            # Dependency failures are not a channel for private source/parser text.
            raise ValueError from None
        if (parser.cursor != len(text) or parser.stack or parser.active is not None
                or tuple(row[0] for row in parser.rows) != mapping.selections):
            raise ValueError
        passages = tuple(Passage(row[0].locator, row[1], row[2].derived_text_sha256) for row in parser.rows)
        if sum(len(passage.text.encode('utf8')) for passage in passages) > MAX_CAPTURE_TEXT_BYTES:
            raise ValueError
        snapshot = PassageSnapshot(document.source_key, document.item_key, document.source_version_id,
            document.content_sha256, binding.mapping_sha256, binding.language_code, passages)
        validate_snapshot(snapshot)
        spans = tuple(row[2] for row in parser.rows)
        manifest = dict(schema_version=1, adapter_identity=ADAPTER_IDENTITY, parser_identity=PARSER_IDENTITY,
            source_key=document.source_key, item_key=document.item_key, source_version_id=document.source_version_id,
            source_url=document.source_url, content_sha256=document.content_sha256, original_bytes=len(raw),
            retrieved_at=document.retrieved_at.isoformat(timespec='microseconds'),
            mapping_sha256=binding.mapping_sha256, language_code=binding.language_code,
            coverage='selected_elements_parsed_text_only', rendered_visibility_verified=False,
            spans=[dict(locator=span.locator, element_id=span.element_id, tag=span.tag,
                start=span.start, end=span.end, raw_sha256=span.raw_sha256,
                derived_text_sha256=span.derived_text_sha256) for span in spans])
        encoded = json.dumps(manifest, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode('utf8')
        return BoundHtmlPassages(document, snapshot, spans, encoded, sha256(encoded).hexdigest())
    except Exception:
        raise HtmlPassageError('html_passage_binding_unavailable') from None
