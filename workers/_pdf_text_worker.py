"""Fixed stdin-only PDF parser child; private data never selects a path or action."""
import sys
from pathlib import Path


def main():
    try:
        if sys.argv[1:]or sys.platform!='linux':raise ValueError
        import resource
        # These are fixed before importing the third-party parser or reading PDF.
        for name,limit in((resource.RLIMIT_AS,268435456),(resource.RLIMIT_CPU,2),
                           (resource.RLIMIT_CORE,0),(resource.RLIMIT_FSIZE,0)):
            resource.setrlimit(name,(limit,limit))
            if resource.getrlimit(name)!=(limit,limit):raise ValueError
        import logging
        import warnings
        logging.disable(logging.CRITICAL);warnings.simplefilter('ignore')
        from hashlib import sha256
        from io import BytesIO
        import pypdf
        if pypdf.__version__!='6.21.0':raise ValueError
        sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
        from workers.pdf_text_inspection import LIMITS,PARSER_IDENTITY,_encode,admitted_page_text
        raw=sys.stdin.buffer.read(LIMITS['max_input_bytes']+1)
        if not 1<=len(raw)<=LIMITS['max_input_bytes']:raise ValueError
        result=dict(schema_version=1,kind='bounded_native_pdf_text',original_sha256=sha256(raw).hexdigest(),
                    original_bytes=len(raw),parser_identity=PARSER_IDENTITY,limits=dict(LIMITS),state='held',
                    reason_code='pdf_parse_unavailable',page_count=None,pages=[])
        try:
            reader=pypdf.PdfReader(BytesIO(raw),strict=True)
            if reader.is_encrypted:result['reason_code']='pdf_encrypted'
            else:
                count=len(reader.pages)
                if not 1<=count<=LIMITS['max_pages']:result['reason_code']='pdf_page_limit'
                else:
                    result.update(state='inspected',reason_code=None,page_count=count)
                    total=0
                    for index in range(count):
                        row=dict(page_number=index+1,state='held',text=None,text_sha256=None,reason_code='page_extraction_unavailable')
                        try:
                            page=reader.pages[index];content=page.get_contents()
                            if content is not None and len(content.get_data())>LIMITS['max_main_content_bytes']:
                                row['reason_code']='page_content_limit'
                            else:
                                text=page.extract_text(orientations=(0,90,180,270),extraction_mode='plain')
                                if text is None or text=='':row.update(state='no_native_text',reason_code=None)
                                elif type(text)is not str:row['reason_code']='page_text_unusable'
                                else:
                                    body=text.encode('utf8')
                                    if len(body)>LIMITS['max_page_text_bytes']:row['reason_code']='page_text_limit'
                                    elif not admitted_page_text(text):row['reason_code']='page_text_unusable'
                                    else:
                                        total+=len(body)
                                        if total>LIMITS['max_total_text_bytes']:raise ValueError
                                        row.update(state='text_extracted',text=text,text_sha256=sha256(body).hexdigest(),reason_code=None)
                        except Exception:pass
                        result['pages'].append(row)
        except Exception:
            result.update(state='held',reason_code='pdf_parse_unavailable',page_count=None,pages=[])
        output=_encode(result)
        if len(output)>LIMITS['max_output_bytes']:
            result.update(state='held',reason_code='pdf_output_limit',page_count=None,pages=[]);output=_encode(result)
        if sys.stdout.buffer.write(output)!=len(output):raise ValueError
        sys.stdout.buffer.flush();return 0
    except BaseException:
        try:sys.stderr.write('pdf_inspection_unavailable\n')
        except Exception:pass
        return 1


if __name__=='__main__':raise SystemExit(main())
