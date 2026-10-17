"""Fixed private full-original PDF-to-whole-issue composition, no backend."""
import sys
from scripts.offline_pdf_request_context import _closed
from scripts.offline_stored_pdf_preparation import _decode as stored_input, MAX_INPUT_BYTES as MAX_STORED_INPUT
from workers.closed_pair_channel import _json as strict_json, _binary
from workers.error_diagnostics import diagnostic_worker
from workers.issue_review_composition import MAX_BASELINE_BYTES,MAX_CONTEXT_BYTES
from workers.pdf_appended_issue_review import prepare_pdf_appended_issue_review,pdf_composition_parts,PdfAppendedIssueReviewError
from workers.private_extraction_held_proposal import _json

MAX_INPUT_BYTES=1152*1024
MAX_OUTPUT_BYTES=256*1024
PART_NAMES=('candidateReportJson','baselineJson','canonicalBaselineJson','contextJson','proposalJson','compositionJson')
HELP=('Offline private PDF whole-issue review: supply private_pdf_whole_issue_review_input v1 on stdin, '
      'with the complete stored-preparation input and separately supplied historical baseline and whole-issue context. '
      'One cold opening checks every present original; output preserves all six composition parts. '
      'Strict TypeScript admission with independently retained expectations remains required. '
      'No input path, source request, model, database, capture, current eligibility or publication is selected. '
      'Supervise EOF/deadline and discard partial output unless exit zero and complete admission succeed.\n')
CODE='offline_pdf_whole_issue_review_unavailable'

class OfflinePdfWholeIssueInputError(ValueError):pass
class OfflinePdfWholeIssueTechnicalError(RuntimeError):pass


def _decode(raw):
    if type(raw)is not bytes or not 1<=len(raw)<=MAX_INPUT_BYTES:raise ValueError
    v=_closed(strict_json(raw),('schema_version','kind','stored_preparation_input_base64','baseline_base64','context_base64'))
    if type(v['schema_version'])is not int or v['schema_version']!=1 or v['kind']!='private_pdf_whole_issue_review_input':raise ValueError
    baseline=_binary(v['baseline_base64'],MAX_BASELINE_BYTES);context=_binary(v['context_base64'],MAX_CONTEXT_BYTES)
    if type(strict_json(baseline))is not dict or type(strict_json(context))is not dict:raise ValueError
    receipt,expected,result,pdf_expected,intent,at=stored_input(_binary(v['stored_preparation_input_base64'],MAX_STORED_INPUT))
    return dict(raw=receipt,expected=expected,baseline_raw=baseline,context_raw=context,
        receipt=result,extraction_expected=pdf_expected,intent_raw=intent,observed_at=at)


def composition_from_envelope(raw):
    try:values=_decode(raw)
    except (ValueError,TypeError,KeyError,AttributeError,UnicodeError,OverflowError,RecursionError):raise OfflinePdfWholeIssueInputError(CODE)from None
    except Exception:raise OfflinePdfWholeIssueTechnicalError(CODE)from None
    try:prepared=prepare_pdf_appended_issue_review(**values)
    except PdfAppendedIssueReviewError:raise OfflinePdfWholeIssueInputError(CODE)from None
    except Exception:raise OfflinePdfWholeIssueTechnicalError(CODE)from None
    try:
        parts=pdf_composition_parts(prepared)
        output=_json(dict(zip(PART_NAMES,(part.decode('utf8','strict')for part in parts))))+b'\n'
        if len(output)>MAX_OUTPUT_BYTES:raise ValueError
        return output
    except Exception:raise OfflinePdfWholeIssueTechnicalError(CODE)from None


def main(*,args=None,stdin=None,stdout=None,stderr=None):
    args=sys.argv[1:]if args is None else args;stdin=sys.stdin.buffer if stdin is None else stdin
    stdout=sys.stdout.buffer if stdout is None else stdout;stderr=sys.stderr if stderr is None else stderr
    try:
        with diagnostic_worker('collector_worker'):
            if args==['--help']:stderr.write(HELP);return 0
            if args:stderr.write('offline_pdf_whole_issue_review_arguments_refused\n');return 2
            try:output=composition_from_envelope(stdin.read(MAX_INPUT_BYTES+1))
            except OfflinePdfWholeIssueInputError:stderr.write(CODE+'\n');return 2
            if stdout.write(output)!=len(output):raise OSError
            stdout.flush();return 0
    except Exception:
        try:stderr.write(CODE+'\n')
        except Exception:pass
        return 1

if __name__=='__main__':raise SystemExit(main())
