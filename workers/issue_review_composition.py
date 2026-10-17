"""Shared structural append-only issue composition after format admission.

Callers capture and validate their own complete format-specific inputs first.
This helper preserves exact baseline/current-head assertions and old claim
order. It supplies no source, capture, publication or whole-payload acceptance.
"""
from hashlib import sha256
from uuid import UUID
from workers.private_extraction_held_proposal import _json,_shape,_text,_date
from workers.closed_pair_channel import _json as strict_json

MAX_BASELINE_BYTES=24576
MAX_CONTEXT_BYTES=32768
MAX_PAYLOAD_BYTES=16384
MAX_PROOF_BYTES=65536
MAX_TRANSFER_BYTES=126976
INTENT='append_only_whole_issue_technical_review_not_publication'
PART_KEYS=('candidate_report','baseline','canonical_baseline','context','proposal','composition')


def _publication_uuid(value):
    # Preserve valid baseline UUID spelling. Final public syntax is still
    # checked by the existing TypeScript schema, without normalizing bytes.
    if type(value) is not str:return False
    try:return str(UUID(value))==value.lower()
    except ValueError:return False


def _claims(claims):
    if type(claims) is not list or not 1<=len(claims)<=30:raise ValueError
    identities=set();sources={};cited=[]
    for claim in claims:
        if type(claim) is not dict or not _publication_uuid(claim.get('id')) or claim['id'].lower() in identities:raise ValueError
        identities.add(claim['id'].lower())
        references=claim.get('evidence')
        if type(references) is not list or not 1<=len(references)<=12:raise ValueError
        for reference in references:
            if type(reference) is not dict or not _publication_uuid(reference.get('sourceVersionId')):raise ValueError
            source=reference['sourceVersionId'];signature=_json({k:v for k,v in reference.items() if k not in ('locator','relation')})
            if source.lower() in sources and sources[source.lower()]!=(source,signature):raise ValueError
            if source.lower() not in sources:cited.append(source)
            sources[source.lower()]=(source,signature)
    return cited


def compose_known_issue_candidate(payload,original,baseline_raw,context_raw,observed_at):
    """Internal structural composition over already copied/admitted values."""
    old_head=original['issue']['head']
    if old_head['publication_id'] is None:raise ValueError
    context=_shape(strict_json(context_raw),'schema_version kind snapshot_intent baseline page review')
    if type(context['schema_version']) is not int or context['schema_version']!=1 or context['kind']!='invented_append_only_issue_context' or context['snapshot_intent']!=INTENT:raise ValueError
    witness=_shape(context['baseline'],'publication_id issue_id content_sha256 head_changed_at head_observed_at')
    expected=dict(publication_id=old_head['publication_id'],issue_id=original['issue']['issue_id'],content_sha256=old_head['content_sha256'],head_changed_at=old_head['changed_at'],head_observed_at=original['issue']['observed_at'])
    if _json(witness)!=_json(expected) or sha256(baseline_raw).hexdigest()!=witness['content_sha256']:raise ValueError
    baseline=_shape(strict_json(baseline_raw),'id issueId revision kind snapshot dependencyManifest')
    if (baseline['id']!=witness['publication_id'] or baseline['issueId']!=witness['issue_id'] or type(baseline['revision']) is not int
            or not 1<=baseline['revision']<=9007199254740991 or baseline['kind'] not in ('accepted','correction')):raise ValueError
    snapshot=_shape(baseline['snapshot'],'schemaVersion jurisdictionSlug issueSlug title summary lastEvidenceReviewOn claims')
    if (type(snapshot['schemaVersion']) is not int or snapshot['schemaVersion']!=1 or snapshot['jurisdictionSlug']!=payload['snapshot']['jurisdictionSlug']
            or snapshot['issueSlug']!=payload['snapshot']['issueSlug'] or not 1<=len(snapshot['claims'])<=29):raise ValueError
    cited=_claims(snapshot['claims']);manifest=_shape(baseline['dependencyManifest'],'sourceVersionIds')['sourceVersionIds']
    if (type(manifest) is not list or not 1<=len(manifest)<=120 or any(not _publication_uuid(x) for x in manifest)
            or len({x.lower() for x in manifest})!=len(manifest) or set(manifest)!=set(cited)):raise ValueError
    page=_shape(context['page'],'title summary last_evidence_review_on')
    _text(page['title'],240);_text(page['summary'],1600)
    if _date(page['last_evidence_review_on'])>observed_at.date():raise ValueError
    review=_shape(context['review'],'conflict_coverage translation')
    translation=_shape(review['translation'],'display_language status')
    if (review['conflict_coverage']!='not_recorded' or translation['status'] not in ('unreviewed','not_recorded')
            or translation['display_language']!=payload['translation']['displayLanguage']):raise ValueError
    claims=[*snapshot['claims'],payload['snapshot']['claims'][0]];all_cited=_claims(claims)
    source_ids=[*manifest,*[source for source in all_cited if source not in manifest]]
    proposed=dict(schemaVersion=1,kind='review_only',snapshot=dict(schemaVersion=1,jurisdictionSlug=snapshot['jurisdictionSlug'],issueSlug=snapshot['issueSlug'],
        title=page['title'],summary=page['summary'],lastEvidenceReviewOn=page['last_evidence_review_on'],claims=claims),
        dependencyManifest=dict(sourceVersionIds=source_ids),conflictCoverage='not_recorded',translation=dict(displayLanguage=translation['display_language'],status=translation['status']))
    return baseline,snapshot,context,claims,proposed
