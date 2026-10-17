"""Private shared detached context dialect for actual HTML/PDF callers.

Correspondence/proposed support only. Callers own full original/receipt reopening,
entry-time capture, source provenance and fixed private errors. No I/O or grants.
"""
import json,re
from workers.private_extraction_held_proposal import (MAX_CONTEXT_BYTES,MAX_PAYLOAD_BYTES,
    _json,_unique,_shape,_text,_instant,_date)
from workers.feed_postgres_contract import _uuid

def _capture_spelling(value):
    # Existing TypeScript capture display schemas use ECMAScript trim, whose
    # boundary BOM differs from Python strip. Hold instead of rewriting exact
    # payload text. Raw model date and original/context bytes remain untouched.
    if type(value) is str:
        if value.startswith('\ufeff') or value.endswith('\ufeff'):raise ValueError
    elif type(value) is dict:
        for item in value.values():_capture_spelling(item)
    elif type(value) is list:
        for item in value:_capture_spelling(item)



def _prepare_detached_context(independent_context, *, current, proposal, artifact_values, stored_at, observed_at, maximum_payload_bytes):
    # Internal actual-producer primitives; never an authenticated public DTO.
    if type(independent_context) is not bytes or not 1<=len(independent_context)<=MAX_CONTEXT_BYTES:raise ValueError
    if type(maximum_payload_bytes) is not int or not 1<=maximum_payload_bytes<=MAX_PAYLOAD_BYTES:raise ValueError
    b=current
    ctx=_shape(json.loads(independent_context.decode('utf8'),object_pairs_hook=_unique),
        'schema_version kind snapshot_intent artifact held issue content support translation')
    if (type(ctx['schema_version']) is not int or ctx['schema_version']!=1 or ctx['kind']!='invented_detached_extraction_context'
            or ctx['snapshot_intent']!='single_claim_technical_review_not_issue_replacement'):raise ValueError
    artifact=_shape(ctx['artifact'],'operation_id artifact_id request_sha256 output_sha256')
    exact={key:artifact_values[key] for key in artifact}
    if artifact!=exact:raise ValueError
    held=_shape(ctx['held'],'run_id decision_id item_key source_version_id content_sha256 locator jurisdiction_id decided_at disposition')
    if (not all(_uuid(held[k]) for k in ('run_id','decision_id','source_version_id')) or held['disposition']!='held'
            or held['item_key']!=b['item_key'] or held['source_version_id']!=b['source_version_id']
            or held['content_sha256']!=b['content_sha256'] or held['locator']!=proposal['locator']):raise ValueError
    _text(held['jurisdiction_id'],80);decided=_instant(held['decided_at'])
    if not stored_at<=decided<=observed_at:raise ValueError
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
    if content['source_published_on'] is not None and _date(content['source_published_on'])>_instant(b['retrieved_at']).date():raise ValueError
    support=_shape(ctx['support'],'source_version_id content_sha256 locator assertion claim_type relation assignment_state')
    if support!=dict(source_version_id=b['source_version_id'],content_sha256=b['content_sha256'],locator=proposal['locator'],
            assertion=proposal['proposed_assertion'],claim_type=proposal['proposed_claim_type'],relation='supports',assignment_state='proposed_only'):raise ValueError
    translation=_shape(ctx['translation'],'display_language status')
    if (type(translation['display_language']) is not str or not re.fullmatch(r'[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?',translation['display_language'])
            or translation['display_language']!=proposal['language_code'] or translation['status'] not in ('not_recorded','unreviewed')):raise ValueError
    evidence=dict(sourceVersionId=b['source_version_id'],publisher=content['publisher'],title=content['source_title'],url=b['source_url'],
        locator=proposal['locator'],relation='supports',sourcePublishedOn=content['source_published_on'],retrievedAt=b['retrieved_at'])
    payload=dict(schemaVersion=1,kind='review_only',snapshot=dict(schemaVersion=1,jurisdictionSlug=issue['jurisdiction_slug'],issueSlug=issue['issue_slug'],
        title=content['title'],summary=content['summary'],lastEvidenceReviewOn=content['last_evidence_review_on'],
        claims=[dict(id=content['claim_id'],type=proposal['proposed_claim_type'],assertion=proposal['proposed_assertion'],periodLabel=content['period_label'],evidence=[evidence])]),
        dependencyManifest=dict(sourceVersionIds=[b['source_version_id']]),conflictCoverage='not_recorded',
        translation=dict(displayLanguage=translation['display_language'],status=translation['status']))
    _capture_spelling(payload)
    raw=_json(payload)
    if len(raw)>maximum_payload_bytes:raise ValueError
    selection=_json(dict(captureId=content['capture_id'],runId=held['run_id'],decisionId=held['decision_id'],issueId=issue['issue_id'],basePublicationId=head['publication_id']))
    return raw,selection,ctx,exact
