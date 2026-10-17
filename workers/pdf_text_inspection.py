"""Opt-in local native PDF inspection through one fixed owned Linux child.

Derived page text is not an original-byte span, visual reading, table/OCR
qualification, factual support or source/access/publication permission. The
caller supplies already lawful original bytes and independent receipt metadata.
No path, URL, password, command or environment is selected by that material.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
from fractions import Fraction
from hashlib import sha256
from workers.dispatch_input_snapshot import freeze_input, thaw_input
import json
from math import isfinite, nextafter
from pathlib import Path
from re import fullmatch
import subprocess
import sys
import time

from workers.bounded_worker_process import communicate_bounded
from workers.native_parent_guard import native_parent_command
from workers.public_source_url import public_https_source_url

PARSER_IDENTITY='pypdf/6.21.0:strict:plain'
SCOPE='native_pdf_page_text_only_unverified'
LIMITS=dict(max_input_bytes=65536,max_pages=8,max_main_content_bytes=1048576,
    max_page_text_bytes=8192,max_total_text_bytes=65536,max_output_bytes=131072,
    wall_seconds=3,cpu_seconds=2,address_space_bytes=268435456,core_bytes=0,file_bytes=0)
WHOLE_HOLDS=frozenset({'pdf_encrypted','pdf_parse_unavailable','pdf_page_limit','pdf_output_limit'})
PAGE_HOLDS=frozenset({'page_content_limit','page_text_limit','page_text_unusable','page_extraction_unavailable'})


class PdfInspectionError(ValueError):
    """Generic refusal without source, path, parser diagnostics or child output."""


class PdfInspectionInputError(PdfInspectionError):
    """Expected malformed original/receipt input; no child is started."""


@dataclass(frozen=True)
class PdfDocumentReceipt:
    source_key: str
    item_key: str
    source_version_id: str
    source_url: str
    content_sha256: str
    retrieved_at: datetime
    media_type: str='application/pdf'


def _plain(value, maximum):
    if type(value)is not str or not 1<=len(value)<=maximum or value!=value.strip()or any(ord(c)<32 for c in value):return False
    try:value.encode('utf8');return True
    except UnicodeError:return False


def _utc(value):return type(value)is datetime and value.tzinfo is not None and value.utcoffset()==timezone.utc.utcoffset(value)
def _stamp(value):return value.isoformat(timespec='microseconds').replace('+00:00','Z')
def _encode(value):return (json.dumps(value,ensure_ascii=False,allow_nan=False,separators=(',',':'))+'\n').encode('utf8')


def _object(pairs):
    value={}
    for key,item in pairs:
        if key in value:raise ValueError
        value[key]=item
    return value


def _constant(_):raise ValueError


def _closed(value,keys):
    if type(value)is not dict or set(value)!=set(keys):raise ValueError


def admitted_page_text(value):
    if type(value)is not str or not value.strip()or any(ord(c)<32 and c not in '\t\n\r'for c in value):return False
    try:return 1<=len(value.encode('utf8'))<=LIMITS['max_page_text_bytes']
    except UnicodeError:return False


def _native_reply(raw,original):
    if type(raw)is not bytes or not 1<=len(raw)<=LIMITS['max_output_bytes']:raise ValueError
    value=json.loads(raw.decode('utf8'),object_pairs_hook=_object,parse_constant=_constant)
    _closed(value,('schema_version','kind','original_sha256','original_bytes','parser_identity','limits','state','reason_code','page_count','pages'))
    if(type(value['schema_version'])is not int or value['schema_version']!=1 or value['kind']!='bounded_native_pdf_text'
       or value['parser_identity']!=PARSER_IDENTITY or type(value['original_bytes'])is not int or value['original_bytes']!=len(original)
       or value['original_sha256']!=sha256(original).hexdigest()or type(value['limits'])is not dict
       or value['limits']!=LIMITS or any(type(v)is not int for v in value['limits'].values())or type(value['pages'])is not list):raise ValueError
    if value['state']=='held':
        if value['reason_code']not in WHOLE_HOLDS or value['page_count']is not None or value['pages']!=[]:raise ValueError
    elif value['state']=='inspected':
        if(value['reason_code']is not None or type(value['page_count'])is not int or not 1<=value['page_count']<=LIMITS['max_pages']
           or len(value['pages'])!=value['page_count']):raise ValueError
        total=0
        for number,page in enumerate(value['pages'],1):
            _closed(page,('page_number','state','text','text_sha256','reason_code'))
            if type(page['page_number'])is not int or page['page_number']!=number:raise ValueError
            if page['state']=='text_extracted':
                if not admitted_page_text(page['text'])or page['reason_code']is not None or page['text_sha256']!=sha256(page['text'].encode('utf8')).hexdigest():raise ValueError
                total+=len(page['text'].encode('utf8'))
            elif page['state']=='no_native_text':
                if page['text']is not None or page['text_sha256']is not None or page['reason_code']is not None:raise ValueError
            elif page['state']=='held':
                if page['text']is not None or page['text_sha256']is not None or page['reason_code']not in PAGE_HOLDS:raise ValueError
            else:raise ValueError
        if total>LIMITS['max_total_text_bytes']:raise ValueError
    else:raise ValueError
    return value


def _cleanup(process):
    # The handle never escapes; every postspawn failure also owns retirement.
    try:
        if process.poll()is None:process.kill()
        process.wait(timeout=1)
        if type(process.poll())is not int:raise ValueError
    finally:
        for name in('stdin','stdout','stderr'):
            stream=getattr(process,name,None)
            if stream is not None and not stream.closed:stream.close()


def inspect_pdf_bytes(raw: bytes,document: PdfDocumentReceipt,*,observed_at: datetime):
    """Inspect exact supplied bytes; no implicit fetch, storage, model or retry.

    Linux resource limits are containment controls, not a filesystem/network
    sandbox. The fixed worker uses BytesIO only and never opens PDF destinations.
    Original wall time includes validation, command construction and Popen.
    """
    process=None
    try:
        began=time.monotonic()
        if type(began)not in(int,float)or not isfinite(began):raise ValueError
        deadline=Fraction(began)+LIMITS['wall_seconds'];previous=began
        def remaining():
            nonlocal previous
            now=time.monotonic()
            if type(now)not in(int,float)or not isfinite(now)or now<previous:raise ValueError
            previous=now;left=deadline-Fraction(now)
            if left<=0:raise ValueError
            approximate=float(left)
            if Fraction(approximate)>left:approximate=nextafter(approximate,0.0)
            if not 0<approximate<=LIMITS['wall_seconds']:raise ValueError
            return approximate
        try:
            if(type(raw)is not bytes or not 1<=len(raw)<=LIMITS['max_input_bytes']or type(document)is not PdfDocumentReceipt
               or type(observed_at)is not datetime):raise ValueError
            raw,document,observed_at=thaw_input(freeze_input((raw,document,observed_at),(PdfDocumentReceipt,)))
            if not _utc(observed_at):raise ValueError
            # Capture all original metadata once, before the process boundary.
            values={name:getattr(document,name)for name in('source_key','item_key','source_version_id','source_url','content_sha256','retrieved_at','media_type')}
            if(not _plain(values['source_key'],120)or fullmatch('[a-z0-9][a-z0-9:-]{0,119}',values['source_key'])is None
               or not _plain(values['item_key'],120)or type(values['source_version_id'])is not str
               or fullmatch('[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}',values['source_version_id'])is None
               or not public_https_source_url(values['source_url'])or type(values['content_sha256'])is not str
               or values['content_sha256']!=sha256(raw).hexdigest()or not _utc(values['retrieved_at'])or values['retrieved_at']>observed_at
               or type(values['media_type'])is not str or values['media_type']!='application/pdf'):raise ValueError
            values['retrieved_at']=_stamp(values['retrieved_at']);at=_stamp(observed_at)
        except (ValueError,TypeError,AttributeError,UnicodeError,OverflowError):
            raise PdfInspectionInputError('pdf_inspection_unavailable')from None
        command=native_parent_command((sys.executable,'-I','-B',str(Path(__file__).with_name('_pdf_text_worker.py').resolve())))
        remaining()
        process=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={},close_fds=True)
        output=communicate_bounded(process,raw,timeout=remaining(),max_input=LIMITS['max_input_bytes'],max_stdout=LIMITS['max_output_bytes'],max_stderr=256)
        remaining()
        if output.returncode!=0 or output.stderr!=b'':raise ValueError
        native=_native_reply(output.stdout,raw)
        report=dict(schema_version=1,kind='private_pdf_text_inspection',scope=SCOPE,document=values,observed_at=at,
                    original_bytes=len(raw),parser_identity=PARSER_IDENTITY,limits=dict(LIMITS),
                    **{name:native[name]for name in('state','reason_code','page_count','pages')})
        if len(_encode(report))>LIMITS['max_output_bytes']:
            report.update(state='held',reason_code='pdf_output_limit',page_count=None,pages=[])
        remaining()
        return report
    except PdfInspectionInputError:raise
    except Exception:
        raise PdfInspectionError('pdf_inspection_unavailable')from None
    finally:
        if process is not None:
            try:
                _cleanup(process)
                remaining()
            except Exception:raise PdfInspectionError('pdf_inspection_unavailable')from None
