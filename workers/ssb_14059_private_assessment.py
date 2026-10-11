"""First private pair to held machine proposals, with exact custody binding.

No caller-supplied pass flags, model confidence or public qualification enters
this first-scope assessment. Values are parsed in memory; records contain no
numeric cells or response bodies. A saved proposal is not a durable decision,
usable pair, checkpoint, registration, permission or website publication.
"""
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from re import fullmatch

from workers.automatic_publication_gate import (EvidenceReceipt, RouteQualification,
    CandidateChecks, MachineDecisionInput, propose_machine_disposition)
from workers.ssb_14059_batch import assemble_private_ssb_14059_batch
from workers.ssb_14059_capture import DATA_URL, CapturedResponse
from workers.ssb_14059_recovery import ExpectedRawPair
from workers.ssb_14059_semantic_contract import HELD_MEANINGS, selected_definition_sha256
from workers.ssb_14059_validation_proposal import propose_private_ssb_14059_pair_validation
from workers.update_run_completion import _uuid


def build_first_private_ssb_assessment(metadata_response, data_response, binding, *, pair_id, versions, now):
    if type(metadata_response) is not CapturedResponse or type(data_response) is not CapturedResponse \
            or not isinstance(binding, ExpectedRawPair) or type(versions) is not dict \
            or set(versions) != {'metadata', 'data'} or not _uuid(pair_id) \
            or any(not _uuid(v) for v in versions.values()) or versions['metadata'] == versions['data'] \
            or type(now) is not datetime or now.utcoffset() != timedelta(0):
        raise ValueError('Private assessment context refused')
    if any(type(x) is not str or fullmatch('[0-9a-f]{64}', x) is None
            for x in (binding.metadata_sha256, binding.data_sha256)) \
            or type(binding.attempt_id) is not str or fullmatch('[0-9a-f]{32}', binding.attempt_id) is None \
            or any(type(stamp) is not datetime or stamp.utcoffset() != timedelta(0)
                for stamp in (binding.metadata_retrieved_at, binding.data_retrieved_at, binding.stored_at, binding.expires_at)) \
            or not binding.metadata_retrieved_at <= binding.data_retrieved_at <= binding.stored_at <= now < binding.expires_at \
            or binding.expires_at != binding.metadata_retrieved_at + timedelta(days=30):
        raise ValueError('Private assessment custody expired or disagrees')
    if metadata_response.retrieved_at != binding.metadata_retrieved_at \
            or data_response.retrieved_at != binding.data_retrieved_at \
            or sha256(metadata_response.body).hexdigest() != binding.metadata_sha256 \
            or sha256(data_response.body).hexdigest() != binding.data_sha256:
        raise ValueError('Private assessment differs from retained response bytes')
    batch = assemble_private_ssb_14059_batch(metadata_response=metadata_response,
        data_response=data_response, previous_accepted_data=None, previous_accepted_metadata=None)
    disposition = propose_private_ssb_14059_pair_validation(batch)
    contract_hash = selected_definition_sha256(metadata_response)
    qualification = RouteQualification('private-ssb-unqualified', 'private-assessment-v1',
        'ssb-14059-data', DATA_URL, DATA_URL, 'structured_observation', 'private-ssb-parser-v1',
        'inactive', False, now, 0, len(HELD_MEANINGS), contract_hash)
    checks = CandidateChecks(source_version_current=False, evidence_locator_verified=True,
        identity_resolved=False, fields_dates_units_verified=False, semantics_qualified=False,
        no_material_conflict=False, public_snapshot_consistent=False,
        expected_predecessor_current=False, no_sensitive_data=False)
    candidates = []
    for candidate in batch.candidates:
        item_key = 'ssb-14059-year-'+str(candidate.survey_year)
        locators = {'lowerBand': candidate.lower_band_locator, 'upperBand': candidate.upper_band_locator,
                    'responseCount': candidate.respondent_count_locator}
        evidence = EvidenceReceipt('ssb-14059-data', versions['data'], DATA_URL,
            binding.data_sha256, ';'.join(locators.values()), data_response.retrieved_at)
        proposal = propose_machine_disposition(MachineDecisionInput(item_key, 'shadow',
            'private-assessment-v1', 'inactive', 'candidate', False, 'ssb-14059-data',
            'structured_observation', 'private-ssb-parser-v1', contract_hash,
            evidence, qualification, checks, now))
        if proposal.disposition != 'held':
            raise ValueError('Private assessment unexpectedly proposed public eligibility')
        candidates.append({'itemKey': item_key, 'surveyYear': candidate.survey_year,
            'periodPrecision': 'year', 'dataVersionId': versions['data'],
            'evidenceLocators': locators, 'reviewState': candidate.review_state,
            'machineDisposition': proposal.disposition, 'reasonCodes': list(proposal.reason_codes),
            'numericCellsIncluded': False, 'eligibilityCredentialIssued': False})
    if len(candidates) != 2:
        raise ValueError('First private assessment requires both survey years')
    return {'schemaVersion': 1, 'evidenceKind': 'first_private_ssb_pair_held_assessment',
        'assessedAt': now.isoformat(), 'pairId': pair_id, 'metadataVersionId': versions['metadata'],
        'dataVersionId': versions['data'], 'metadataSha256': binding.metadata_sha256,
        'dataSha256': binding.data_sha256, 'semanticContractSha256': contract_hash,
        'retainedPairMatched': True, 'privatePairProposal': disposition.state,
        'candidates': candidates, 'heldPublicMeanings': list(HELD_MEANINGS),
        'sourceContactVerified': False, 'publicQualificationIssued': False,
        'responseBodiesIncluded': False, 'modelCalls': 0, 'databaseChanged': False,
        'checkpointAdvanced': False, 'publicRulesChanged': False, 'publicationEnabled': False}
