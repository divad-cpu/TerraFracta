"""Strict synthetic SQL receipts bound to separately trusted attempt bytes.

Does not establish database COMMIT, authentication or rendered visibility.
The caller owns trusted canonical input, current head and read-only route.
"""
from dataclasses import dataclass
from datetime import datetime
import json
from re import fullmatch
from workers.source_response_receipts import _unique
from workers.update_run_completion import _uuid,_instant
from workers.visibility_attempts import (VisibilityAttempt,VisibilityExpectation,VisibilityEvaluation,
 evaluate_visibility_attempt)
from workers.exact_timestamp import parse_exact_timestamp

@dataclass(frozen=True)
class SyntheticVisibilityReceipt:
    attempt_id:str
    attempt_key:str
    status:str
    recorded_at:datetime
    evaluation:VisibilityEvaluation


def parse_synthetic_visibility_receipt(data:bytes,attempt:VisibilityAttempt,expected:VisibilityExpectation,*,
                                     attempt_key:str,expected_status:str,current_publication_id:str|None,
                                     now:datetime)->SyntheticVisibilityReceipt:
    try:
        if type(data) is not bytes or not 2<=len(data)<=16384 or type(attempt_key) is not str \
          or fullmatch(r'[a-z0-9][a-z0-9:_-]{0,159}',attempt_key) is None \
          or type(expected_status) is not str or expected_status not in ('stored','existing','latest'):
            raise ValueError
        value=json.loads(data.decode('utf8'),object_pairs_hook=_unique)
        if type(value) is not dict or set(value)!= {'schemaVersion','status','attemptId','attemptKey','runId',
          'publicationId','publicationSha256','observationsSha256','recordedAt','summary'} \
          or type(value['schemaVersion']) is not int or value['schemaVersion']!=1 \
          or value['status']!=expected_status or value['attemptKey']!=attempt_key or not _uuid(value['attemptId']) \
          or (value['runId'],value['publicationId'],value['publicationSha256']) != \
            (expected.run_id,expected.publication_id,expected.publication_sha256):raise ValueError
        evaluation=evaluate_visibility_attempt(attempt,expected,current_publication_id=current_publication_id,now=now)
        if value['observationsSha256']!=evaluation.observations_sha256:raise ValueError
        recorded_at=parse_exact_timestamp(value['recordedAt'])
        if not _instant(recorded_at) or not attempt.finished_at<=recorded_at<=now:raise ValueError
        summary=value['summary']
        if type(summary) is not dict or set(summary)!= {'scope','runtimeVerified','state','matchedSurfaces',
          'missingSurfaces','mismatchedSurfaces','unavailableSurfaces','checkedThrough'} \
          or summary['scope']!='synthetic' or summary['runtimeVerified'] is not False \
          or summary['state']!=evaluation.state:raise ValueError
        for name,rows in (('matchedSurfaces',evaluation.matched_surfaces),('missingSurfaces',evaluation.missing_surfaces),
          ('mismatchedSurfaces',evaluation.mismatched_surfaces),('unavailableSurfaces',evaluation.unavailable_surfaces)):
            if type(summary[name]) is not list or summary[name]!=list(rows):raise ValueError
        checked=parse_exact_timestamp(summary['checkedThrough'])
        if not _instant(checked) or checked!=evaluation.checked_through:raise ValueError
        return SyntheticVisibilityReceipt(value['attemptId'],attempt_key,expected_status,recorded_at,evaluation)
    except (ValueError,TypeError,KeyError,UnicodeError,RecursionError,OverflowError) as exc:
        raise ValueError('Synthetic visibility receipt is inconsistent') from exc
