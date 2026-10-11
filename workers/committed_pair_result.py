"""Pure agreement with trusted custodian observations, not source permission."""
from workers.closed_pair_channel import _binary


def validate_committed_pair_bytes(payload,*,canonical,calls,failures,committed_times,committed_receipts):
    if payload['canonicalManifest']!=canonical or type(payload['operations']) is not int \
            or payload['operations']!=16 or len(calls)!=16 or failures:
        raise ValueError('Private worker operation evidence differs')
    if any(payload[key]!=committed_times.get(key) for key in ('metadataRetrievedAt','dataRetrievedAt')) \
            or _binary(payload['checkpoint'],32768)!=committed_receipts.get('read_pair_checkpoint') \
            or _binary(payload['closeout'],32768)!=committed_receipts.get('read_closeout'):
        raise ValueError('Private worker substituted committed evidence')
