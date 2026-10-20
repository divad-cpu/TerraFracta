"""Passive metadata choices projection; original pre-write intent stays separate."""
from hashlib import sha256
import json
from workers.detached_proposal_inventory import parse_detached_proposal_inventory,_snapshot_inventory_values
from workers.feed_postgres_contract import _time
MAX_CHOICES_REPORT_BYTES=98304


class DetachedProposalChoicesReportError(ValueError):pass


def detached_proposal_choices_report(raw,expected,*,observed_at):
    try:
        raw, expected, observed_at = _snapshot_inventory_values(raw, expected, observed_at)
        checked=parse_detached_proposal_inventory(raw,expected,observed_at=observed_at)
        artifact=checked.request.extraction
        value=dict(schema_version=1,kind='invented_detached_preparation_choices',review_state='historical_metadata_only',
            scope='invented_offline_rehearsal_only',inventory_response_sha256=sha256(raw).hexdigest(),
            lookup_scope_json=checked.request.canonical_scope.decode('utf8'),artifact_stored_at=_time(artifact.stored.stored_at),
            artifact_observed_at=_time(artifact.observed_at),inventory_observed_at=_time(checked.observed_at),report_observed_at=_time(observed_at),
            candidates=[dict(operation_id=row.operation_id,artifact_id=row.artifact_id,prepared_at=_time(row.prepared_at),stored_at=_time(row.stored_at),
                metadata_intent_json=row.intent.canonical_metadata.decode('utf8')) for row in checked.candidates])
        encoded=json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode('utf8')
        if len(encoded)>MAX_CHOICES_REPORT_BYTES:raise ValueError
        return encoded
    except Exception:raise DetachedProposalChoicesReportError('detached_proposal_choices_unavailable') from None
