"""Generate supplied-input vectors for the new cross-language report boundary.

No old suite is executed. No original, source, file-upload, model or backend
operation is supplied to the application; only invented report JSON is emitted.
"""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import json
from dataclasses import replace
from tests.test_html_inspection_report import capture, examples, OBSERVED, AT
from workers.html_inspection_report import html_inspection_report
from workers.html_passage_binding import HtmlElementSelection


def report(current, previous=None):
    return json.loads(html_inspection_report(current, previous, observed_at=OBSERVED))


def vectors():
    current, previous, _ = examples()
    markup = capture(b'<nav>Changed wrapping</nav>'+previous.raw)
    selections = (HtmlElementSelection('one', 'one'), HtmlElementSelection('two', 'two'))
    unicode = capture('<article><p id="one">Å e\u0301 😀 &amp; &lt;script&gt;quoted&lt;/script&gt;</p><p id="two">Å e\u0301 😀 &amp; &lt;script&gt;quoted&lt;/script&gt;</p></article>'.encode(), selections=selections)
    large_selections = tuple(HtmlElementSelection(f'part:{i}', f'p{i}') for i in range(7))
    large_raw = ''.join(f'<p id="p{i}">'+(str(i)+'"'*8191)+'</p>' for i in range(7)).encode()
    large = capture(large_raw, selections=large_selections)
    single = (HtmlElementSelection('one', 'one'),)
    normal = capture(b'<p id="one">Scalar text</p>', selections=single)
    bom_text = capture('<p id="one">﻿</p>'.encode(), selections=single)
    def with_item(value):
        return replace(normal, document=replace(normal.document, item_key=value),
            binding=replace(normal.binding, item_key=value))
    nel_locator = replace(normal, mapping=replace(normal.mapping,
        selections=(HtmlElementSelection('one\u0085locator', 'one'),)))
    return dict(bom_text=report(bom_text), bom_item=report(with_item('\ufeffitem')),
        nel_item=report(with_item('item\u0085key')), nel_locator=report(nel_locator), first=report(current), identical=report(previous, previous), wrapping=report(markup, previous),
        unicode=report(unicode), held=report(large))


if __name__ == '__main__':
    print(json.dumps(vectors(), ensure_ascii=False, separators=(',', ':')))
