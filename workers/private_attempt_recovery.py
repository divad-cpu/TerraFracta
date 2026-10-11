"""Read-only classification of first private capture and retained raw custody.

The caller supplies an independently obtained native snapshot and held custody.
Saved admission is checked historically at its own timestamp, never treated as
current permission, a source-origin proof or authority to replay a write/fetch.
No client, account, source request, deletion, repair or qualification is issued.
"""
from datetime import datetime,timezone
from hashlib import sha256
import json

from workers.closed_pair_channel import _json
from workers.native_pair_admission import confirm_native_pair_admission,FIELDS as ADMISSION_FIELDS
from workers.private_attempt_readiness import utc_time
from workers.ssb_14059_raw_custody import PrivateRawCustody,PrivateRawCustodyError
from workers.ssb_14059_raw_binding_receipt import parse_raw_binding
from workers.ssb_14059_recovery import ExpectedRawPair
from workers.update_run_completion import parse_canonical_run_manifest,reconcile_run_completion
from workers.update_run_closeout import parse_run_closeout

SNAPSHOT_FIELDS={'schemaVersion','observedAt','runId','workClaimId','pairId','canonicalRequest',
    'codeVersion','requestFingerprint','counts','checkpoint','rawBinding','closeout','sourceVersions'}
COUNT_FIELDS={'reservations','dispatches','settlements','chargedBytes','versions','pairs','checks',
    'manifests','rawArtifacts','closeouts','checkpoints','usablePairs','publications'}
CHECKPOINT_FIELDS={'schemaVersion','runId','workClaimId','canonicalManifest','manifestSha256','pairId',
    'validationState','metadataVersionId','dataVersionId'}


def historical_admission(raw):
    """Reconstruct bounded historical context; this never authenticates a client."""
    try:
        if type(raw) is not bytes or not 2<=len(raw)<=16384:raise ValueError
        value=_json(raw)
        if type(value) is not dict or set(value)!=ADMISSION_FIELDS:raise ValueError
        observed=utc_time(value['observedAt'])
        responses=value['responseContexts']
        context={'request':_json(value['canonicalRequest'].encode('ascii')),
            'work':{'status':'claimed','run_id':value['runId'],'lease_id':value['workClaimId'],
                'attempt':value['workAttempt'],'lease_expires_at':value['leaseExpiresAt'],
                'deadline_at':value['deadlineAt'],'observed_at':value['observedAt']},
            'responses':{kind:{'registration_id':responses[kind]['registrationId'],
                'request_key':responses[kind]['requestKey']} for kind in ('metadata','data')},
            'versions':{kind:responses[kind]['sourceVersionId'] for kind in ('metadata','data')},
            'pairId':value['pairId'],'principal':value['principal']}
        # Canonical request deliberately excludes its idempotency key. This
        # synthetic key is used only to validate the historical bounded shape;
        # it is never a lookup key, admission request or execution authority.
        context['request']['request_key']='historical:private:observation'
        encoded=json.dumps(context,separators=(',',':')).encode()
        admission=confirm_native_pair_admission(raw,encoded,value['sourceInventorySha256'],now=observed)
        return admission,value
    except (ValueError,TypeError,KeyError,AttributeError,UnicodeError,RecursionError,OverflowError):
        raise ValueError('Historical private admission is unavailable') from None


def classify_private_attempt_recovery(admission_raw,native_raw,custody,*,now=None):
    now=datetime.now(timezone.utc) if now is None else now
    try:
        if not isinstance(now,datetime) or now.tzinfo is None or now.utcoffset()!=timezone.utc.utcoffset(now):
            raise ValueError
        if type(custody) is not PrivateRawCustody or type(native_raw) is not bytes or not 2<=len(native_raw)<=32768:
            raise ValueError
        admission,saved=historical_admission(admission_raw);context=admission.context
        value=_json(native_raw)
        if type(value) is not dict or set(value)!=SNAPSHOT_FIELDS or type(value['schemaVersion']) is not int \
                or value['schemaVersion']!=1 or value['runId']!=saved['runId'] or value['workClaimId']!=saved['workClaimId'] \
                or value['pairId']!=saved['pairId'] or value['canonicalRequest']!=saved['canonicalRequest'] \
                or value['codeVersion']!='ssb-sha256:'+admission.source_fingerprint \
                or value['requestFingerprint']!=sha256(saved['canonicalRequest'].encode('ascii')).hexdigest():
            raise ValueError
        observed=utc_time(value['observedAt'])
        if not admission.observed_at<=observed<=now or (now-observed).total_seconds()>3:raise ValueError
        counts=value['counts']
        if type(counts) is not dict or set(counts)!=COUNT_FIELDS or any(type(x) is not int or x<0 for x in counts.values()) \
                or not counts['settlements']<=counts['dispatches']<=counts['reservations']<=2 \
                or counts['chargedBytes']>65537*counts['reservations'] or counts['pairs'] not in (0,1) \
                or any(counts[key] for key in ('checkpoints','usablePairs','publications')):
            raise ValueError
        paired=counts['pairs']==1
        for key,expected in (('versions',2*int(paired)),('checks',2*int(paired)),
                ('manifests',int(paired)),('rawArtifacts',int(paired))):
            if counts[key]!=expected:raise ValueError
        if counts['closeouts'] not in (0,1) or counts['closeouts']!=int(value['closeout'] is not None):raise ValueError
        report={'schemaVersion':1,'evidenceKind':'read_only_private_attempt_recovery','observedAt':observed.isoformat(),
            'state':'incomplete_before_private_store','retainedRawPairs':0,'rawIntegrityChecked':False,
            'nativeCloseoutPresent':bool(counts['closeouts']),'readingChargeBytes':counts['chargedBytes'],
            'historicalAdmissionOnly':True,'currentAdmissionIssued':False,'sourceOriginVerified':False,
            'automaticRetry':False,'repairPerformed':False,'checkpointAdvanced':False,'publicationEnabled':False}
        if not paired:
            if value['checkpoint'] is not None or value['rawBinding'] is not None or value['closeout'] is not None \
                    or value['sourceVersions']!=[]:raise ValueError
            names=custody.attempt_names();report['retainedRawPairs']=len(names)
            if names:report['state']='orphan_requires_inspection'
            return report
        checkpoint=value['checkpoint'];binding=value['rawBinding']
        if type(checkpoint) is not dict or set(checkpoint)!=CHECKPOINT_FIELDS \
                or type(checkpoint['schemaVersion']) is not int or checkpoint['schemaVersion']!=1 \
                or checkpoint['runId']!=saved['runId'] or checkpoint['workClaimId']!=saved['workClaimId'] \
                or checkpoint['pairId']!=context.pair_id or checkpoint['validationState']!='pending' \
                or checkpoint['metadataVersionId']!=context.metadata_version_id or checkpoint['dataVersionId']!=context.data_version_id:
            raise ValueError
        manifest=parse_canonical_run_manifest(checkpoint['canonicalManifest'].encode('ascii'))
        if manifest.mode!='shadow' or manifest.run_id!=saved['runId'] \
                or manifest.request_fingerprint!=value['requestFingerprint'] \
                or checkpoint['manifestSha256']!=sha256(checkpoint['canonicalManifest'].encode('ascii')).hexdigest():raise ValueError
        e=ExpectedRawPair(binding['rawAttemptId'],binding['metadataSha256'],binding['dataSha256'],
            utc_time(binding['expiresAt']),utc_time(binding['metadataRetrievedAt']),
            utc_time(binding['dataRetrievedAt']),utc_time(binding['storedAt']))
        parse_raw_binding(json.dumps(binding,separators=(',',':')).encode(),pair_id=context.pair_id,
            versions={'metadata':context.metadata_version_id,'data':context.data_version_id},expected=e)
        if not admission.observed_at<=e.metadata_retrieved_at<=e.stored_at<=observed \
                or not admission.observed_at<=e.data_retrieved_at<=e.stored_at:raise ValueError
        expected_sources={key:(request.registration_id,version,digest) for key,request,version,digest in (
            ('ssb-14059-metadata',context.metadata,context.metadata_version_id,e.metadata_sha256),
            ('ssb-14059-data',context.data,context.data_version_id,e.data_sha256))}
        if {row.source_key:(row.registration_id,row.source_version_id,row.content_sha256) for row in manifest.sources}!=expected_sources:
            raise ValueError
        if {(row.item_key,row.source_key,row.source_version_id) for row in manifest.items}!= {
                ('ssb-14059-year-2024','ssb-14059-data',context.data_version_id),
                ('ssb-14059-year-2025','ssb-14059-data',context.data_version_id),
                ('ssb-14059-metadata-review','ssb-14059-metadata',context.metadata_version_id)}:raise ValueError
        expected_versions=sorted(({'id':version,'registrationId':registration,'contentSha256':digest}
            for registration,version,digest in expected_sources.values()),key=lambda row:row['id'])
        if value['sourceVersions']!=expected_versions:raise ValueError
        if counts['reservations']!=2 or counts['dispatches']!=2 or counts['settlements']!=2:raise ValueError
        if value['closeout'] is not None:
            parse_run_closeout(json.dumps(value['closeout'],separators=(',',':')).encode(),manifest,saved['workClaimId'],
                reconcile_run_completion(manifest,(),(),(),now=observed),started_at=admission.observed_at,now=observed)
        names=custody.attempt_names();report['retainedRawPairs']=len(names)
        if e.expires_at<=now:
            report['state']='expired_access_held';return report
        if names!=(e.attempt_id,):
            report['state']='raw_namespace_inconsistent';return report
        try:retained=custody.read(e.attempt_id,now=now)
        except PrivateRawCustodyError:
            report['state']='raw_pair_unavailable';return report
        if retained.stored_at!=e.stored_at or retained.expires_at!=e.expires_at or retained.metadata_response.retrieved_at!=e.metadata_retrieved_at \
                or retained.data_response.retrieved_at!=e.data_retrieved_at \
                or sha256(retained.metadata_response.body).hexdigest()!=e.metadata_sha256 \
                or sha256(retained.data_response.body).hexdigest()!=e.data_sha256 \
                or counts['chargedBytes']!=len(retained.metadata_response.body)+len(retained.data_response.body):raise ValueError
        report['rawIntegrityChecked']=True
        report['state']='stored_pending_closeout_confirmed' if value['closeout'] is not None else 'stored_pending_closeout_unconfirmed'
        return report
    except (ValueError,TypeError,KeyError,AttributeError,UnicodeError,RecursionError,OverflowError):
        raise ValueError('Private recovery snapshot is inconsistent or unavailable') from None


def inspect_journaled_private_attempt_recovery(directory, native_raw, custody, *, now=None):
    """Combine a preserved terminal journal with independently supplied readback.

    Unknown or missing local cleanup suppresses native/raw classification even
    when a snapshot is supplied. A historical finish cannot authenticate that
    snapshot. The trusted caller still obtains it through the constrained read
    account; this helper opens no SQL connection and authorizes no retry/repair.
    """
    from workers.private_custodian_journal import _read_chain, _directory, _metadata, FILENAME
    now = datetime.now(timezone.utc) if now is None else now
    try:
        if not isinstance(now, datetime) or now.tzinfo is None or now.utcoffset() != timezone.utc.utcoffset(now) \
                or type(custody) is not PrivateRawCustody \
                or (native_raw is not None and (type(native_raw) is not bytes or not 2 <= len(native_raw) <= 32768)):
            raise ValueError
        identity = _directory(directory)
        raws, start, finish = _read_chain(directory); metadata = _metadata(directory, set(raws))
        recorded_at = start['startedAt'] if finish is None else finish['observedAt']
        if utc_time(recorded_at) > now: raise ValueError
        journal_state = 'outcome_not_recorded' if finish is None else (
            finish['outcome'] if finish['nativeCleanupConfirmed'] else 'local_cleanup_unconfirmed')
        result = {'schemaVersion': 1, 'evidenceKind': 'read_only_journaled_private_attempt_recovery',
            'observedAt': now.isoformat(), 'journalRecordedAt': recorded_at, 'journalState': journal_state,
            'state': 'journal_requires_inspection', 'nativeSnapshotChecked': False,
            'rawAccessWithheldByJournal': True, 'nativeRecovery': None,
            'historicalObservationOnly': True, 'currentAdmissionIssued': False, 'sourceOriginVerified': False,
            'automaticRetry': False, 'repairPerformed': False, 'checkpointAdvanced': False, 'publicationEnabled': False}
        if finish is not None and finish['nativeCleanupConfirmed']:
            admission = raws.get(FILENAME)
            if admission is None:
                result['state'] = 'no_saved_native_admission'
            elif native_raw is None:
                result['state'] = 'fresh_native_snapshot_required'
            else:
                recovery = classify_private_attempt_recovery(admission, native_raw, custody, now=now)
                if utc_time(recovery['observedAt']) < utc_time(finish['observedAt']): raise ValueError
                result.update(state=recovery['state'], nativeSnapshotChecked=True,
                    rawAccessWithheldByJournal=False, nativeRecovery=recovery)
        # Preserve journal uncertainty if it changes while native/raw evidence
        # is being classified. Never infer an authorized historical-state repair.
        reopened, _start, _finish = _read_chain(directory)
        if reopened != raws or _directory(directory) != identity or _metadata(directory, set(raws)) != metadata:
            raise ValueError
        return result
    except (ValueError, OSError, TypeError, KeyError, AttributeError, UnicodeError, RecursionError, OverflowError):
        raise ValueError('Journaled private recovery is inconsistent or unavailable; preserve existing evidence') from None
