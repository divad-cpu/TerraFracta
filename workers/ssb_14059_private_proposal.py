"""Inactive first-pair SSB representation, never an authority or source opener.

A trusted installation must independently load committed pair/source/decision
and actual issue-head observations. These immutable inputs check correspondence;
constructing their Python types does not authenticate a caller or a database.
The output is detached private review content for the existing strict encoder.
Recovery uses stored canonical bytes, not this preparation function.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta
from re import fullmatch

from workers.ssb_14059_batch import assemble_private_ssb_14059_batch
from workers.ssb_14059_capture import DATA_URL, METADATA_URL
from workers.ssb_14059_private_assessment import build_first_private_ssb_assessment
from workers.update_run_completion import _uuid

TITLE = 'Private review: SSB 14059 housing-expense variables'
SUMMARY = ('Private technical assessment of the fixed SSB table 14059 responses for 2024 and 2025. '
    'Values are recorded using API variable codes. English band-boundary, respondent and fieldwork wording '
    'remains unqualified. This draft makes no significance or policy-effect finding. '
    'The recorded last-evidence-review date is the automated technical held-decision date; '
    'it does not represent a human or editorial review of this proposal.')
ASSERTION = ('For survey year {year}, the fixed SSB 14059 response for EierStatus=0 reports '
    'Boutg4={lower} percent and Boutg5={upper} percent. The English band-boundary meaning remains unreviewed.')
METADATA_LOCATOR = 'table=14059;ContentsCode=Boutg4,Boutg5;Tid=2024,2025;EierStatus=0'


@dataclass(frozen=True)
class SourceVersionWitness:
    run_id: str
    pair_id: str
    source_key: str
    source_version_id: str
    source_url: str
    content_sha256: str
    retrieved_at: datetime


@dataclass(frozen=True)
class PairVersionWitness:
    """Independent committed pair membership, separate from version rows."""
    run_id: str
    pair_id: str
    metadata_version_id: str
    data_version_id: str


@dataclass(frozen=True)
class HeldSSBDecisionWitness:
    run_id: str
    pair_id: str
    decision_id: str
    jurisdiction_id: str
    item_key: str
    disposition: str
    source_version_id: str
    content_sha256: str
    semantic_contract_sha256: str
    evidence_locator: str
    reason_codes: tuple[str, ...]
    decided_at: datetime


@dataclass(frozen=True)
class IssueHeadWitness:
    """An observed head row; None witness means unavailable, not empty head."""
    issue_id: str
    jurisdiction_id: str
    jurisdiction_slug: str
    issue_slug: str
    issue_created_at: datetime
    observed_at: datetime
    publication_id: str | None
    content_sha256: str | None
    head_changed_at: datetime | None


def _utc(value):
    return type(value) is datetime and value.utcoffset() == timedelta(0)


def _hash(value):
    return type(value) is str and fullmatch('[0-9a-f]{64}', value) is not None


def prepare_private_ssb_proposal(metadata_response, data_response, raw_binding, *,
        run_id, pair_id, pair, sources, decision, target, claim_id, now):
    """Prepare one annual held proposal from an independently witnessed pair.

    No fetch, write, model, qualification, public projection or generated ID.
    The current-work command rechecks the actual base/fence atomically at write;
    this pure function cannot observe a database change after its head witness.
    """
    if not _uuid(run_id) or not _uuid(pair_id) or not _uuid(claim_id) or not _utc(now) \
            or type(sources) is not tuple or len(sources) != 2 \
            or any(type(s) is not SourceVersionWitness for s in sources) \
            or type(pair) is not PairVersionWitness \
            or type(decision) is not HeldSSBDecisionWitness or type(target) is not IssueHeadWitness:
        raise ValueError('Private SSB proposal context unavailable')
    versions = {s.source_key: s for s in sources}
    if set(versions) != {'ssb-14059-metadata', 'ssb-14059-data'}:
        raise ValueError('Private SSB proposal source witnesses disagree')
    meta, data = versions['ssb-14059-metadata'], versions['ssb-14059-data']
    if pair.run_id != run_id or pair.pair_id != pair_id \
            or pair.metadata_version_id != meta.source_version_id or pair.data_version_id != data.source_version_id \
            or meta.source_version_id == data.source_version_id:
        raise ValueError('Private SSB proposal source witnesses disagree')
    for source, response, url in ((meta, metadata_response, METADATA_URL), (data, data_response, DATA_URL)):
        if source.run_id != run_id or source.pair_id != pair_id or not _uuid(source.source_version_id) \
                or source.source_url != url or not _hash(source.content_sha256) or not _utc(source.retrieved_at):
            raise ValueError('Private SSB proposal source witnesses disagree')
    # Reuse exact raw/custody/expiry/selected-definition and held-meaning checks.
    assessment = build_first_private_ssb_assessment(metadata_response, data_response, raw_binding,
        pair_id=pair_id, versions={'metadata': meta.source_version_id, 'data': data.source_version_id}, now=now)
    if any(source.content_sha256 != assessment[key] or source.retrieved_at != response.retrieved_at
            for source, response, key in ((meta, metadata_response, 'metadataSha256'), (data, data_response, 'dataSha256'))):
        raise ValueError('Private SSB proposal differs from witnessed source bytes')
    if decision.run_id != run_id or decision.pair_id != pair_id or not _uuid(decision.decision_id) \
            or decision.disposition != 'held' or decision.source_version_id != data.source_version_id \
            or decision.content_sha256 != data.content_sha256 \
            or decision.semantic_contract_sha256 != assessment['semanticContractSha256'] \
            or not _utc(decision.decided_at) or not raw_binding.stored_at <= decision.decided_at <= now:
        raise ValueError('Private SSB proposal held decision disagrees')
    held = next((c for c in assessment['candidates'] if c['itemKey'] == decision.item_key), None)
    if held is None or type(decision.reason_codes) is not tuple \
            or decision.reason_codes != tuple(held['reasonCodes']) \
            or decision.evidence_locator != ';'.join(held['evidenceLocators'].values()):
        raise ValueError('Private SSB proposal annual decision disagrees')
    if not _uuid(target.issue_id) or type(target.jurisdiction_id) is not str \
            or not 1 <= len(target.jurisdiction_id) <= 80 or target.jurisdiction_id != decision.jurisdiction_id \
            or target.jurisdiction_slug != 'norway' or target.issue_slug != 'housing-cost-burden' \
            or not _utc(target.issue_created_at) or not _utc(target.observed_at) \
            or not max(target.issue_created_at, decision.decided_at) <= target.observed_at <= now:
        raise ValueError('Private SSB proposal target unavailable or stale')
    base = (target.publication_id, target.content_sha256, target.head_changed_at)
    if any(x is None for x in base):
        if not all(x is None for x in base):
            raise ValueError('Private SSB proposal incomplete base witness')
    elif not _uuid(target.publication_id) or not _hash(target.content_sha256) \
            or not _utc(target.head_changed_at) or not target.issue_created_at <= target.head_changed_at <= target.observed_at:
        raise ValueError('Private SSB proposal invalid base witness')
    batch = assemble_private_ssb_14059_batch(metadata_response=metadata_response, data_response=data_response,
        previous_accepted_data=None, previous_accepted_metadata=None)
    candidate = next(c for c in batch.candidates if c.survey_year == held['surveyYear'])
    # Decimal formatting retains validated tokens; no sums, count or rounding.
    assertion = ASSERTION.format(year=candidate.survey_year,
        lower=format(candidate.share_40_59_percent, 'f'), upper=format(candidate.share_upper_band_percent, 'f'))
    def evidence(source, title, locator, relation):
        return {'sourceVersionId': source.source_version_id, 'publisher': 'Statistics Norway (SSB)',
            'title': title, 'url': source.source_url, 'locator': locator, 'relation': relation,
            'sourcePublishedOn': None, 'retrievedAt': source.retrieved_at.isoformat(timespec='microseconds').replace('+00:00', 'Z')}
    return {'schemaVersion': 1, 'kind': 'review_only', 'snapshot': {'schemaVersion': 1,
        'jurisdictionSlug': target.jurisdiction_slug, 'issueSlug': target.issue_slug,
        'title': TITLE, 'summary': SUMMARY, 'lastEvidenceReviewOn': decision.decided_at.date().isoformat(),
        'claims': [{'id': claim_id, 'type': 'condition', 'assertion': assertion,
            'periodLabel': f'Survey year {candidate.survey_year}', 'evidence': [
                evidence(data, 'SSB table 14059 fixed six-cell response', decision.evidence_locator, 'supports'),
                evidence(meta, 'SSB table 14059 selected metadata', METADATA_LOCATOR, 'context')]}]},
        'dependencyManifest': {'sourceVersionIds': [data.source_version_id, meta.source_version_id]},
        'conflictCoverage': 'not_recorded', 'translation': {'displayLanguage': 'en', 'status': 'unreviewed'}}
