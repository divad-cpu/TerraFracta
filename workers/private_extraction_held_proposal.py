"""Detached invented preparation for the existing strict review-only encoder.

Independent context is a correspondence assertion, never authentication or a
substantive support finding. No ID allocation, decision, merge, query, capture,
work completion or publication. The provenance companion has no durable sink.
"""
from dataclasses import dataclass,field
from datetime import datetime,date,timedelta
from hashlib import sha256
import json,re
from workers.private_extraction_report import private_extraction_review_report
from workers.private_extraction_reopen import ReopenedPrivateExtractionResult,parse_reopened_private_extraction
from workers.feed_postgres_contract import _uuid,_time

MAX_CONTEXT_BYTES=32768
MAX_PAYLOAD_BYTES=16384
MAX_PROVENANCE_BYTES=65536
class PrivateExtractionHeldProposalError(ValueError):pass

@dataclass(frozen=True)
class DetachedExtractionProposal:
    payload_raw: bytes=field(repr=False)
    selection_raw: bytes=field(repr=False)
    provenance_raw: bytes=field(repr=False)
    evidence_state: str='invented_unverified_detached_not_captured'

def _json(value):return json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode('utf8')
def _unique(pairs):
    out={}
    for key,value in pairs:
        if key in out:raise ValueError
        out[key]=value
    return out

def _shape(value,fields):
    if type(value) is not dict or set(value)!=set(fields.split()):raise ValueError
    return value

def _text(value,limit):
    if (type(value) is not str or not 1<=len(value)<=limit or value!=value.strip()
            or any(ord(c)<32 and c not in '\n\t' for c in value)):raise ValueError
    value.encode('utf8');return value

def _instant(value):
    if type(value) is not str or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z',value):raise ValueError
    return datetime.fromisoformat(value.replace('Z','+00:00'))

def _date(value):
    if type(value) is not str or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',value):raise ValueError
    return date.fromisoformat(value)

def prepare_private_extraction_held_proposal(reopened,independent_context: bytes,*,observed_at) -> DetachedExtractionProposal:
    """One explicitly supplied private candidate, not a replacement issue snapshot.

    Both full originals/output are rechecked; the report alone is insufficient.
    Proposed support, issue/head, held decision and review-date metadata must be
    supplied independently. Preserve all three returned byte strings together.
    """
    try:
        if (type(reopened) is not ReopenedPrivateExtractionResult or type(independent_context) is not bytes
                or not 1<=len(independent_context)<=MAX_CONTEXT_BYTES or type(observed_at) is not datetime
                or observed_at.utcoffset()!=timedelta(0)):raise ValueError
        report=json.loads(private_extraction_review_report(reopened))
        checked=parse_reopened_private_extraction(reopened.full_receipt,reopened.request,observed_at=reopened.observed_at)
        if observed_at<checked.observed_at:raise ValueError
        r=checked.result;b=r.current.request.binding
        ctx=_shape(json.loads(independent_context.decode('utf8'),object_pairs_hook=_unique),
            'schema_version kind snapshot_intent artifact held issue content support translation')
        if type(ctx['schema_version']) is not int or ctx['schema_version']!=1 or ctx['kind']!='invented_detached_extraction_context' or ctx['snapshot_intent']!='single_claim_technical_review_not_issue_replacement':raise ValueError
        artifact=_shape(ctx['artifact'],'operation_id artifact_id request_sha256 output_sha256')
        exact=dict(operation_id=checked.stored.operation_id,artifact_id=checked.stored.artifact_id,
            request_sha256=r.request.request_sha256,output_sha256=sha256(r.output_raw).hexdigest())
        if artifact!=exact:raise ValueError
        held=_shape(ctx['held'],'run_id decision_id item_key source_version_id content_sha256 locator jurisdiction_id decided_at disposition')
        if (not all(_uuid(held[k]) for k in ('run_id','decision_id','source_version_id')) or held['disposition']!='held'
                or held['item_key']!=b.item_key or held['source_version_id']!=b.source_version_id
                or held['content_sha256']!=b.content_sha256 or held['locator']!=r.proposal.locator):raise ValueError
        _text(held['jurisdiction_id'],80)
        decided=_instant(held['decided_at'])
        if not checked.stored.stored_at<=decided<=observed_at:raise ValueError
        issue=_shape(ctx['issue'],'issue_id jurisdiction_id jurisdiction_slug issue_slug created_at observed_at head')
        if not _uuid(issue['issue_id']) or issue['jurisdiction_id']!=held['jurisdiction_id']:raise ValueError
        for key,limit in (('jurisdiction_slug',80),('issue_slug',100)):
            if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*',_text(issue[key],limit)):raise ValueError
        created=_instant(issue['created_at']);head_at=_instant(issue['observed_at'])
        if not max(created,decided)<=head_at<=observed_at:raise ValueError
        head=_shape(issue['head'],'publication_id content_sha256 changed_at')
        base=tuple(head[k] for k in ('publication_id','content_sha256','changed_at'))
        if any(v is None for v in base):
            if not all(v is None for v in base):raise ValueError
        elif (not _uuid(base[0]) or type(base[1]) is not str or not re.fullmatch('[a-f0-9]{64}',base[1])
                or not created<=_instant(base[2])<=head_at):raise ValueError
        content=_shape(ctx['content'],'capture_id claim_id title summary period_label last_evidence_review_on review_date_basis publisher source_title source_published_on')
        if not all(_uuid(content[k]) for k in ('capture_id','claim_id')) or content['review_date_basis']!='independently_supplied_not_inferred':raise ValueError
        for key,limit in (('title',240),('summary',1600),('period_label',160),('publisher',160),('source_title',240)):_text(content[key],limit)
        if _date(content['last_evidence_review_on'])>observed_at.date():raise ValueError
        if content['source_published_on'] is not None and _date(content['source_published_on'])>b.retrieved_at.date():raise ValueError
        support=_shape(ctx['support'],'source_version_id content_sha256 locator assertion claim_type relation assignment_state')
        if support!=dict(source_version_id=b.source_version_id,content_sha256=b.content_sha256,locator=r.proposal.locator,
                assertion=r.proposal.proposed_assertion,claim_type=r.proposal.proposed_claim_type,
                relation='supports',assignment_state='proposed_only'):raise ValueError
        translation=_shape(ctx['translation'],'display_language status')
        if (type(translation['display_language']) is not str or not re.fullmatch(r'[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?',translation['display_language'])
                or translation['display_language']!=r.proposal.language_code or translation['status'] not in ('not_recorded','unreviewed')):raise ValueError
        evidence=dict(sourceVersionId=b.source_version_id,publisher=content['publisher'],title=content['source_title'],
            url=b.source_url,locator=r.proposal.locator,relation=support['relation'],
            sourcePublishedOn=content['source_published_on'],retrievedAt=_time(b.retrieved_at))
        payload=dict(schemaVersion=1,kind='review_only',snapshot=dict(schemaVersion=1,
            jurisdictionSlug=issue['jurisdiction_slug'],issueSlug=issue['issue_slug'],title=content['title'],summary=content['summary'],
            lastEvidenceReviewOn=content['last_evidence_review_on'],claims=[dict(id=content['claim_id'],type=r.proposal.proposed_claim_type,
                assertion=r.proposal.proposed_assertion,periodLabel=content['period_label'],evidence=[evidence])]),
            dependencyManifest=dict(sourceVersionIds=[b.source_version_id]),conflictCoverage='not_recorded',
            translation=dict(displayLanguage=translation['display_language'],status=translation['status']))
        raw=_json(payload)
        if len(raw)>MAX_PAYLOAD_BYTES:raise ValueError
        selection=_json(dict(captureId=content['capture_id'],runId=held['run_id'],decisionId=held['decision_id'],issueId=issue['issue_id'],basePublicationId=head['publication_id']))
        provenance=_json(dict(schema_version=1,kind='detached_private_extraction_proposal',scope='invented_offline_rehearsal_only',
            evidence_state='unverified_not_captured_no_durable_association',snapshot_intent=ctx['snapshot_intent'],artifact=exact,current=report['current'],previous=report['previous'],
            full_receipt_sha256=sha256(reopened.full_receipt).hexdigest(),selected_payload_sha256=r.request.selected_payload_sha256,
            independent_context=ctx,context_sha256=sha256(_json(ctx)).hexdigest(),supplied_context_sha256=sha256(independent_context).hexdigest(),
            artifact_prepared_at=_time(r.prepared_at),artifact_stored_at=_time(checked.stored.stored_at),artifact_observed_at=_time(checked.observed_at),payload_sha256=sha256(raw).hexdigest(),selection_sha256=sha256(selection).hexdigest(),
            claim_id=content['claim_id'],source_date_text=r.proposal.source_date_text,review_date_basis=content['review_date_basis'],
            prepared_at=_time(observed_at)))
        if len(provenance)>MAX_PROVENANCE_BYTES:raise ValueError
        return DetachedExtractionProposal(raw,selection,provenance)
    except Exception:
        raise PrivateExtractionHeldProposalError('private_extraction_held_proposal_unavailable') from None
