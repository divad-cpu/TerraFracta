"""Whitelist the actual retained failed-capture closeout for the local preview."""
from datetime import datetime,timedelta
import json
from pathlib import Path
import sys
from scripts.check_captured_pipeline_failure import ROOT,PROOF


def build_snapshot(record):
    expected={'reservations':1,'dispatches':1,'settlements':1,'sourceChecks':2,'failedChecks':1,'deferredChecks':1,
              'versions':0,'manifests':1,'closeouts':1,'activations':0,'chargedBytes':65537}
    if record.get('evidenceKind')!='actual_owner_failed_capture_partial_closeout' or record.get('network')!='none' or \
       record.get('primaryChanged') is not False or record.get('runtimeAccepted') is not False or \
       type(record.get('actualSourceFetches')) is not int or record['actualSourceFetches']!=0 or \
       record.get('uncertainChargeRetained') is not True or record.get('counts')!=expected or \
       any(type(record['counts'][key]) is not int for key in expected) or \
       record.get('terminalSettlement')!={'outcome':'uncertain','chargedBodyBytes':65537,'contentSha256':None} or \
       any(type(record.get(key)) is not int for key in ('fixtureOpenAttempts','fixtureStreamsOpened','dependentSourceRequests')) or \
       type(record.get('terminalSettlement',{}).get('chargedBodyBytes')) is not int or \
       record.get('fixtureOpenAttempts')!=1 or record.get('fixtureStreamsOpened')!=0 or record.get('dependentSourceRequests')!=0:
        raise ValueError('Capture failure is outside the fixed fictional export')
    source_keys=(record['failedSourceKey'],record['deferredSourceKey'])
    if any(type(key) is not str or not key or len(key)>120 for key in source_keys) or len(set(source_keys))!=2:
        raise ValueError('Failed and dependent source identities must stay distinct')
    summary=record['summary'];due=sorted(source_keys)
    if summary['runState']!='partial' or summary['commitState']!='none' or summary['visibilityState']!='not_required' or \
       summary['dueSourceKeys']!=due or summary['missingSourceKeys']!=due or summary['coveredSourceKeys'] or \
       any(summary[key] for key in ('invalidSourceKeys','pendingItemKeys','committedPublicationIds','visiblePublicationIds',
                                   'pendingVisibilityPublicationIds','failedVisibilityPublicationIds')) or \
       any(type(summary[key]) is not int or summary[key]!=0 for key in ('expectedItems','decidedItems','heldItems')):
        raise ValueError('Failed capture cannot hide missing sources or fabricate findings')
    observed=datetime.fromisoformat(record['observedAt']);finished=datetime.fromisoformat(record['finishedAt'])
    if any(instant.tzinfo is None or instant.utcoffset()!=timedelta(0) for instant in (observed,finished)) or finished>observed:
        raise ValueError('Capture failure chronology is invalid')
    return {'schemaVersion':1,'evidenceKind':'isolated_fictional_capture_failure','recordedAt':record['observedAt'],
        'finishedAt':record['finishedAt'],'runtimeEnabled':False,'externalSourceRequests':0,'runState':'partial','storedFacts':0,
        'requiredSources':2,'coveredSources':0,'failedSources':1,'deferredSources':1,'savedSourceChecks':2,'savedCloseouts':1,
        'readingAllowanceBytes':65537,'retainedChargeBytes':65537,'measuredResponseBytes':None,
        'dependentSourceRequests':0,'sourceVersions':0,'expectedFindings':0}


def main():
    if sys.argv[1:]:raise RuntimeError('Fixed failed-capture export accepts no arguments')
    snapshot=build_snapshot(json.loads((PROOF/'FAILED_CAPTURE_RESULT.json').read_text()))
    destination=ROOT/'fixtures/fictional_capture_failure_snapshot.json'
    if destination.exists():raise RuntimeError('Existing exported evidence is retained')
    destination.write_text(json.dumps(snapshot,indent=2)+'\n')
    print('Exported checked fictional incomplete-run result without private identifiers or fabricated measured bytes.')
    return 0

if __name__=='__main__':raise SystemExit(main())
