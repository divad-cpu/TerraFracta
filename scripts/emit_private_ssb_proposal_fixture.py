"""Fixed invented producer outputs for offline checks, not a runtime entry."""
import json
import sys
from tests.helpers.ssb_private_proposal_fixture import fixture, ident
from workers.ssb_14059_private_proposal import prepare_private_ssb_proposal


def cases():
    results = []
    for year in (2024, 2025):
        args = fixture(year)
        payload = prepare_private_ssb_proposal(**args)
        stamp = lambda value: value.isoformat(timespec='microseconds').replace('+00:00', 'Z')
        d, t = args['decision'], args['target']
        results.append({'year': year, 'payload': payload,
            'scope': {'runId': args['run_id'], 'decisionId': d.decision_id},
            'selection': {'captureId': ident(year+200), 'runId': args['run_id'], 'decisionId': d.decision_id,
                'issueId': t.issue_id, 'basePublicationId': t.publication_id},
            'decision': {'decisionId': d.decision_id, 'decidedAt': stamp(d.decided_at),
                'sourceVersionId': d.source_version_id, 'sourceSha256': d.content_sha256,
                'evidenceLocator': d.evidence_locator, 'reasonCodes': list(d.reason_codes), 'undisclosedReasonCount': 0},
            'target': {'issueId': t.issue_id, 'jurisdictionId': t.jurisdiction_id,
                'jurisdictionSlug': t.jurisdiction_slug, 'issueSlug': t.issue_slug},
            'sourceReceipts': [{'sourceVersionId': s.source_version_id, 'contentSha256': s.content_sha256,
                'retrievedAt': stamp(s.retrieved_at), 'languageCode': 'en'} for s in args['sources']]})
    return {'inventedValues': True, 'trustedWitnessAuthentication': False, 'databaseChanged': False, 'cases': results}


if __name__ == '__main__':
    if len(sys.argv) != 1:
        raise SystemExit('Fixed offline fixture only')
    print(json.dumps(cases()))
