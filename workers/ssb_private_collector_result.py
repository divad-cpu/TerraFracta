"""Validate future private worker output against independent native observations.

No native client, source fetch or public writer is created. Completed transport
children are a process counter, not proof of TLS origin or source approval.
"""
from re import fullmatch
from workers.committed_pair_result import validate_committed_pair_bytes

FIELDS={'schemaVersion','evidenceKind','canonicalManifest','metadataRetrievedAt','dataRetrievedAt',
    'checkpoint','closeout','operations','completedResponseChildren','responseKinds','databaseClientPresent',
    'sourcePermissionIssued','publicQualificationIssued','publicationEnabled','launchReceipt'}
LAUNCH_FIELDS={'schemaVersion','sourceFingerprint','archiveSha256','contextSha256',
    'sealedSource','sealedTransportChildren','repositoryCodeReopened'}
OPERATIONS=tuple(['reserve_response','confirm_response','dispatch_response','confirm_response',
    'settle_response','confirm_response']*2+['store_pair','read_pair_checkpoint','close_processing','read_closeout'])


def validate_private_collector_result(payload,*,expected_launch_receipt,canonical,calls,failures,
        committed_times,committed_receipts):
    if type(payload) is not dict or set(payload)!=FIELDS or type(payload['schemaVersion']) is not int \
            or payload['schemaVersion']!=1 or payload['evidenceKind']!='private_collector_pending_worker_result' \
            or type(payload['completedResponseChildren']) is not int or payload['completedResponseChildren']!=2 \
            or payload['responseKinds']!=['metadata','data'] \
            or any(payload[k] is not False for k in ('databaseClientPresent','sourcePermissionIssued',
                'publicQualificationIssued','publicationEnabled')) or tuple(calls)!=OPERATIONS:
        raise ValueError('Private collector result exceeds its boundary')
    receipt=payload['launchReceipt']
    if type(receipt) is not dict or set(receipt)!=LAUNCH_FIELDS \
            or type(receipt['schemaVersion']) is not int or receipt['schemaVersion']!=1 \
            or receipt['sealedSource'] is not True or receipt['repositoryCodeReopened'] is not False \
            or type(receipt['sealedTransportChildren']) is not int or receipt['sealedTransportChildren']!=2 \
            or any(type(receipt[k]) is not str or fullmatch('[0-9a-f]{64}',receipt[k]) is None
                for k in ('sourceFingerprint','archiveSha256','contextSha256')) or receipt!=expected_launch_receipt:
        raise ValueError('Private collector launch differs from custodian evidence')
    validate_committed_pair_bytes(payload,canonical=canonical,calls=calls,failures=failures,
        committed_times=committed_times,committed_receipts=committed_receipts)
