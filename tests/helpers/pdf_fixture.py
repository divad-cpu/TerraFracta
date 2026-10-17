"""Trusted invented PDF bytes only; no external document or font is opened."""
from io import BytesIO
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject,NameObject,DecodedStreamObject,TextStringObject,ArrayObject,NumberObject


def pdf_bytes(texts=('Invented native paragraph.',None),*,compressed=False,content=None,encrypted=False,unicode_text=False,page_labels=False):
    writer=PdfWriter();writer.add_metadata({'/Title':'Invented local fixture','/Author':'PRIVATE_PDF_METADATA_CANARY'})
    font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})
    if unicode_text:
        cmap=DecodedStreamObject();cmap.set_data(b'/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Test def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange 1 beginbfchar <01> <D801DC00> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end')
        font[NameObject('/ToUnicode')]=writer._add_object(cmap)
    ref=writer._add_object(font)
    for text in texts:
        page=writer.add_blank_page(width=612,height=792)
        if text is not None or content is not None:
            stream=DecodedStreamObject()
            body=b'BT /F1 12 Tf 72 700 Td <01> Tj ET'if unicode_text else b'BT /F1 12 Tf 72 700 Td ('+str(text).replace('\\','\\\\').replace('(','\\(').replace(')','\\)').encode('ascii')+b') Tj ET'
            stream.set_data(body if content is None else content)
            if compressed:stream=stream.flate_encode()
            page[NameObject('/Contents')]=writer._add_object(stream)
            page[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):ref})})
    if page_labels:
        writer._root_object[NameObject('/PageLabels')]=DictionaryObject({NameObject('/Nums'):ArrayObject([NumberObject(0),DictionaryObject({NameObject('/P'):TextStringObject('Untrusted label'),NameObject('/S'):NameObject('/r')})])})
    if encrypted:writer.encrypt('invented-only-password',algorithm='RC4-128')
    target=BytesIO();writer.write(target);return target.getvalue()
