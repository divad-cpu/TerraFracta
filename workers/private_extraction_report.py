"""Bounded passive review projection, not evidence/factual/public acceptance.

Revalidate the entire private artifact and both original documents before
projecting selected text. The earlier vintage is not a current publication or
conflict assessment. No query, file, provider, source or approval operation.
"""
from dataclasses import asdict
from hashlib import sha256
import json
from workers.private_extraction_reopen import ReopenedPrivateExtractionResult,parse_reopened_private_extraction
from workers.reopened_document_change import prepare_reopened_document_change
from workers.document_passage_comparison import compare_document_passages
from workers.feed_postgres_contract import _time
MAX_REVIEW_REPORT_BYTES=256*1024


class PrivateExtractionReportError(ValueError):pass


def _source(reopened):
    b=reopened.request.binding
    return dict(operation_id=reopened.result_request.operation_id,artifact_id=reopened.artifact_id,
        stored_at=_time(reopened.stored_at),source_key=b.source_key,item_key=b.item_key,
        source_version_id=b.source_version_id,source_url=b.source_url,content_sha256=b.content_sha256,
        mapping_sha256=b.mapping_sha256,language_code=b.language_code,retrieved_at=_time(b.retrieved_at))


def private_extraction_review_report(reopened):
    """No trimming or partial report on invalid/mutated/oversized evidence."""
    try:
        if type(reopened) is not ReopenedPrivateExtractionResult:raise ValueError
        checked=parse_reopened_private_extraction(reopened.full_receipt,reopened.request,observed_at=reopened.observed_at)
        if checked!=reopened:raise ValueError
        result=checked.result
        pair=prepare_reopened_document_change(result.current,result.current_receipt,result.previous,result.previous_receipt,
            observed_at=checked.observed_at)
        compared=compare_document_passages(pair.current,pair.previous,observed_at=checked.observed_at)
        selected=json.loads(result.request.body)['selected_payload']
        prior={passage.locator:passage for passage in compared.previous.snapshot.passages}
        groups=[]
        for group in selected['passages']:
            earlier=[]
            for locator in group['locators']:
                passage=prior.get(locator)
                earlier.append(dict(locator=locator,text=None if passage is None else passage.text,
                    text_sha256=None if passage is None else passage.text_sha256))
            groups.append(dict(text=group['text'],text_sha256=group['text_sha256'],locators=group['locators'],earlier=earlier))
        report=dict(schema_version=1,kind='private_extraction_review_report',review_state='unverified',
            scope='invented_offline_rehearsal_only',prepared_at=_time(result.prepared_at),observed_at=_time(checked.observed_at),
            artifact=dict(operation_id=checked.stored.operation_id,artifact_id=checked.stored.artifact_id,
                stored_at=_time(checked.stored.stored_at),output_sha256=sha256(result.output_raw).hexdigest()),
            request=dict(request_sha256=result.request.request_sha256,selected_payload_sha256=result.request.selected_payload_sha256,
                maximum_output_tokens=result.maximum_output_tokens,maximum_output_bytes=8192),
            current=_source(result.current),previous=_source(result.previous),selected_passages=groups,proposal=asdict(result.proposal),
            context=dict(current_publication='not_connected',affected_pages='not_connected',held_decision='not_connected',
                conflict_assessment='not_recorded',translation_assessment='not_recorded',factual_support='not_assessed',
                provider_usage='not_observed',actual_cost='not_observed'))
        encoded=json.dumps(report,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode('utf8')
        if len(encoded)>MAX_REVIEW_REPORT_BYTES:raise ValueError
        return encoded
    except (ValueError,TypeError,AttributeError,KeyError,UnicodeError,OverflowError):
        raise PrivateExtractionReportError('private_extraction_review_report_unavailable') from None
