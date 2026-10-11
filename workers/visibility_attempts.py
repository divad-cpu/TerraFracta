"""One whole, canonical synthetic visibility attempt; no rendered-view proof.

All counts/states derive from separately trusted publication/head inputs.
This slice cannot label real website visibility verified, connect to a reader
or rewrite the original processing closeout.
"""
from dataclasses import dataclass
from datetime import datetime,timezone
from hashlib import sha256
import json
from re import fullmatch
from workers.update_run_completion import SURFACES,_uuid,_instant
from workers.source_response_receipts import _unique

@dataclass(frozen=True)
class SurfaceObservation:
    surface:str
    outcome:str
    checked_at:datetime
    publication_id:str|None=None
    publication_sha256:str|None=None
    source_version_ids:tuple[str,...]=()

@dataclass(frozen=True)
class VisibilityAttempt:
    run_id:str
    publication_id:str
    publication_sha256:str
    expected_source_version_ids:tuple[str,...]
    started_at:datetime
    finished_at:datetime
    observations:tuple[SurfaceObservation,...]

@dataclass(frozen=True)
class VisibilityExpectation:
    run_id:str
    publication_id:str
    publication_sha256:str
    source_version_ids:tuple[str,...]
    activated_at:datetime
    processing_finished_at:datetime

@dataclass(frozen=True)
class VisibilityEvaluation:
    state:str
    matched_surfaces:tuple[str,...]
    missing_surfaces:tuple[str,...]
    mismatched_surfaces:tuple[str,...]
    unavailable_surfaces:tuple[str,...]
    observations_sha256:str
    checked_through:datetime
    runtime_verified:bool=False


def _hash(value):return type(value) is str and fullmatch(r'[0-9a-f]{64}',value) is not None

def _ids(values,*,allow_empty=False):
    return type(values) is tuple and (0 if allow_empty else 1)<=len(values)<=120 \
      and all(_uuid(x) for x in values) and len(set(values))==len(values)

def _timestamp(value):
    if not _instant(value):raise ValueError('Visibility observation time is invalid')
    return value.isoformat(timespec='microseconds')


def canonical_visibility_attempt(attempt:VisibilityAttempt)->str:
    if not isinstance(attempt,VisibilityAttempt) or not _uuid(attempt.run_id) or not _uuid(attempt.publication_id) \
      or not _hash(attempt.publication_sha256) or not _ids(attempt.expected_source_version_ids) \
      or not _instant(attempt.started_at) or not _instant(attempt.finished_at) \
      or not 0<=(attempt.finished_at-attempt.started_at).total_seconds()<=60 \
      or type(attempt.observations) is not tuple or len(attempt.observations)>4:raise ValueError('Visibility attempt is invalid')
    surfaces=set();observations=[]
    for row in attempt.observations:
        if not isinstance(row,SurfaceObservation) or type(row.surface) is not str or row.surface not in SURFACES \
          or row.surface in surfaces or type(row.outcome) is not str or row.outcome not in ('observed','absent','unavailable') \
          or not _instant(row.checked_at) or not attempt.started_at<=row.checked_at<=attempt.finished_at \
          or not _ids(row.source_version_ids,allow_empty=True):raise ValueError('Visibility observation is invalid')
        if row.outcome=='observed':
            if not _uuid(row.publication_id) or not _hash(row.publication_sha256):raise ValueError('Visibility observation identity is invalid')
        elif row.publication_id is not None or row.publication_sha256 is not None or row.source_version_ids:
            raise ValueError('Absent visibility observation cannot carry an observed identity')
        surfaces.add(row.surface)
        observations.append({'surface':row.surface,'outcome':row.outcome,'checkedAt':_timestamp(row.checked_at),
          'observedPublicationId':row.publication_id,'observedPublicationSha256':row.publication_sha256,
          'sourceVersionIds':sorted(row.source_version_ids)})
    payload={'schemaVersion':1,'scope':'synthetic','runId':attempt.run_id,'publicationId':attempt.publication_id,
      'publicationSha256':attempt.publication_sha256,'expectedSourceVersionIds':sorted(attempt.expected_source_version_ids),
      'startedAt':_timestamp(attempt.started_at),'finishedAt':_timestamp(attempt.finished_at),
      'observations':sorted(observations,key=lambda row:row['surface'])}
    return json.dumps(payload,sort_keys=True,separators=(',',':'),ensure_ascii=True)


def parse_visibility_attempt(data:bytes)->VisibilityAttempt:
    try:
        if type(data) is not bytes or not 2<=len(data)<=16384:raise ValueError
        p=json.loads(data.decode('utf8'),object_pairs_hook=_unique)
        if type(p) is not dict or set(p)!= {'schemaVersion','scope','runId','publicationId','publicationSha256',
          'expectedSourceVersionIds','startedAt','finishedAt','observations'} or type(p['schemaVersion']) is not int \
          or p['schemaVersion']!=1 or p['scope']!='synthetic' or type(p['observations']) is not list \
          or type(p['expectedSourceVersionIds']) is not list:raise ValueError
        rows=[]
        for row in p['observations']:
            if type(row) is not dict or set(row)!= {'surface','outcome','checkedAt','observedPublicationId',
              'observedPublicationSha256','sourceVersionIds'} or type(row['sourceVersionIds']) is not list:raise ValueError
            rows.append(SurfaceObservation(row['surface'],row['outcome'],datetime.fromisoformat(row['checkedAt']),
              row['observedPublicationId'],row['observedPublicationSha256'],tuple(row['sourceVersionIds'])))
        attempt=VisibilityAttempt(p['runId'],p['publicationId'],p['publicationSha256'],tuple(p['expectedSourceVersionIds']),
          datetime.fromisoformat(p['startedAt']),datetime.fromisoformat(p['finishedAt']),tuple(rows))
        if canonical_visibility_attempt(attempt).encode()!=data:raise ValueError
        return attempt
    except (ValueError,TypeError,KeyError,UnicodeError,RecursionError,OverflowError) as exc:
        raise ValueError('Visibility attempt bytes are invalid or noncanonical') from exc


def evaluate_visibility_attempt(attempt:VisibilityAttempt,expected:VisibilityExpectation,*,
                                current_publication_id:str|None,now:datetime)->VisibilityEvaluation:
    canonical=canonical_visibility_attempt(attempt)
    if not isinstance(expected,VisibilityExpectation) or not _instant(now) or not _uuid(expected.run_id) \
      or not _uuid(expected.publication_id) or not _hash(expected.publication_sha256) or not _ids(expected.source_version_ids) \
      or not _instant(expected.activated_at) or not _instant(expected.processing_finished_at) \
      or expected.activated_at>expected.processing_finished_at or attempt.finished_at>now \
      or attempt.started_at<expected.processing_finished_at or (current_publication_id is not None and not _uuid(current_publication_id)) \
      or (attempt.run_id,attempt.publication_id,attempt.publication_sha256)!=(expected.run_id,expected.publication_id,expected.publication_sha256) \
      or set(attempt.expected_source_version_ids)!=set(expected.source_version_ids):raise ValueError('Visibility attempt differs from committed expectation')
    matched=[];mismatched=[];unavailable=[]
    for row in attempt.observations:
        if row.outcome=='unavailable':unavailable.append(row.surface)
        elif row.outcome=='observed' and (row.publication_id,row.publication_sha256)==(expected.publication_id,expected.publication_sha256) \
          and set(row.source_version_ids)==set(expected.source_version_ids):matched.append(row.surface)
        else:mismatched.append(row.surface)
    missing=sorted(SURFACES-{x.surface for x in attempt.observations})
    state=('unavailable' if current_publication_id is None else 'superseded' if current_publication_id!=expected.publication_id
      else 'mismatch' if mismatched else 'unavailable' if unavailable else 'partial' if missing else 'matched')
    return VisibilityEvaluation(state,tuple(sorted(matched)),tuple(missing),tuple(sorted(mismatched)),tuple(sorted(unavailable)),
      sha256(canonical.encode()).hexdigest(),attempt.finished_at)


def latest_visibility_attempt(attempts:tuple[VisibilityAttempt,...])->VisibilityAttempt|None:
    """One whole observation window; never merge successes across attempts."""
    if type(attempts) is not tuple or len(attempts)>50:raise ValueError('Visibility attempt set is invalid')
    canonical=[canonical_visibility_attempt(x) for x in attempts]
    if not attempts:return None
    if len({(x.run_id,x.publication_id,x.publication_sha256) for x in attempts})!=1:
        raise ValueError('Visibility attempts cover different publications')
    newest=max(x.finished_at for x in attempts)
    selected={raw:row for raw,row in zip(canonical,attempts) if row.finished_at==newest}
    if len(selected)!=1:raise ValueError('Latest visibility attempt is ambiguous')
    return next(iter(selected.values()))
