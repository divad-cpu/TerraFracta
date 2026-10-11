"""Strict post-COMMIT raw receipt; no file, database or eligibility authority."""
from datetime import datetime,timedelta
import re
import json
from workers.exact_timestamp import parse_exact_timestamp
from workers.closed_pair_channel import _json,_uuid
from workers.ssb_14059_recovery import ExpectedRawPair

FIELDS={'schemaVersion','pairId','rawAttemptId','metadataSha256','dataSha256','storedAt','expiresAt',
        'metadataRetrievedAt','dataRetrievedAt','metadataVersionId','dataVersionId'}


def parse_raw_binding(data,*,pair_id,versions,expected:ExpectedRawPair):
    if type(data) is not bytes or not 2<=len(data)<=4096 or not isinstance(expected,ExpectedRawPair):
        raise ValueError('Invalid private raw binding receipt')
    try:
        _uuid(pair_id);_uuid(versions['metadata']);_uuid(versions['data'])
        if versions['metadata']==versions['data']:
            raise ValueError
        for text,size in ((expected.attempt_id,32),(expected.metadata_sha256,64),(expected.data_sha256,64)):
            if type(text) is not str or re.fullmatch('[0-9a-f]{'+str(size)+'}',text) is None:raise ValueError
        for stamp in (expected.metadata_retrieved_at,expected.data_retrieved_at,expected.stored_at,expected.expires_at):
            if not isinstance(stamp,datetime) or stamp.utcoffset()!=timedelta(0):raise ValueError
        if not expected.metadata_retrieved_at<=expected.data_retrieved_at<=expected.stored_at<expected.expires_at \
                or expected.expires_at!=expected.metadata_retrieved_at+timedelta(days=30) \
                or expected.data_retrieved_at-expected.metadata_retrieved_at>timedelta(minutes=5):raise ValueError
        value=_json(data)
        if type(value) is not dict or set(value)!=FIELDS or type(value['schemaVersion']) is not int or value['schemaVersion']!=1 \
                or value['pairId']!=pair_id or value['metadataVersionId']!=versions['metadata'] or value['dataVersionId']!=versions['data']:
            raise ValueError
        actual=ExpectedRawPair(value['rawAttemptId'],value['metadataSha256'],value['dataSha256'],
            parse_exact_timestamp(value['expiresAt']),parse_exact_timestamp(value['metadataRetrievedAt']),
            parse_exact_timestamp(value['dataRetrievedAt']),parse_exact_timestamp(value['storedAt']))
        if actual!=expected or any(stamp.utcoffset()!=timedelta(0) for stamp in (actual.metadata_retrieved_at,actual.data_retrieved_at,actual.stored_at,actual.expires_at)):raise ValueError
    except (ValueError,TypeError,KeyError,UnicodeError):
        raise ValueError('Private raw binding disagrees with saved custody') from None
    return actual
