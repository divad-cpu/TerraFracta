"""Whitelist three retained, independently read-back fictional pipeline results.

No connection, fetch, write credential or source activation. The immutable
private trial receipt is exported without run/fence/reservation/database IDs.
"""
from datetime import datetime
from hashlib import sha256
import json
from pathlib import Path
import sys
from scripts.captured_fictional_pipeline import ROOT, PROOF


def build_snapshot(record):
    if record['evidenceKind']!='actual_owner_capture_to_processing' or record['network']!='none' or \
       record['actualSourceFetches']!=0 or record['primaryChanged'] is not False or \
       record['authenticatedRuntimeAccepted'] is not False or record['runtimeVisibilityVerified'] is not False:
        raise ValueError('Pipeline evidence is outside the fictional export boundary')
    accepted = []
    expected = {'stored_fact':('partial','committed','pending',1,1),
                'held_finished':('completed','none','not_required',1,0),
                'missing_decision':('partial','none','not_required',0,0)}
    denied = [r for r in record['cases'] if r['caseKey']=='inconsistent_display']
    if len(denied)!=1 or denied[0] != {'caseKey':'inconsistent_display','deniedBeforeCommit':True,
            'activations':0,'activeHeads':0,'closeouts':0}:
        raise ValueError('Actual display rollback evidence is missing')
    for entry in record['cases']:
        key = entry['caseKey']
        if key not in expected: continue
        summary, counts = entry['summary'], entry['counts']
        run_state,commit_state,visibility_state,decisions,activations = expected[key]
        if (summary['runState'],summary['commitState'],summary['visibilityState']) != expected[key][:3] or \
           any(type(counts[k]) is not int or counts[k]!=1 for k in ('runs','reservations','dispatches','settlements','checks','manifests','closeouts')) or \
           type(counts['decisions']) is not int or counts['decisions']!=decisions or \
           type(counts['activations']) is not int or counts['activations']!=activations or \
           type(entry['streamOpens']) is not int or entry['streamOpens']!=1 or \
           counts['chargedBytes'] != len((ROOT/'fixtures/fictional_structured_source.json').read_bytes()) or \
           summary['expectedItems']!=1 or summary['decidedItems']!=decisions or \
           summary['visiblePublicationIds']!=[] or len(summary['dueSourceKeys'])!=1 or \
           summary['coveredSourceKeys']!=summary['dueSourceKeys'] or \
           summary['missingSourceKeys']!=[] or summary['invalidSourceKeys']!=[]:
            raise ValueError('Pipeline checkpoint counts or stages disagree')
        if datetime.fromisoformat(entry['finishedAt'])>datetime.fromisoformat(record['observedAt']):
            raise ValueError('Pipeline finish is after its observation')
        accepted.append({'caseKey':key,'finishedAt':entry['finishedAt'],
            'runState':run_state,'commitState':commit_state,'visibilityState':visibility_state,
            'fixtureReads':entry['streamOpens'],'reservedBytes':65537,'measuredBytes':counts['chargedBytes'],
            'sourceChecks':counts['checks'],'savedManifests':counts['manifests'],'expectedItems':1,
            'decidedItems':decisions,'heldItems':summary['heldItems'],'storedFacts':activations,
            'pendingItems':len(summary['pendingItemKeys']),'visibleFacts':0})
    if len(accepted)!=3 or {r['caseKey'] for r in accepted} != set(expected):
        raise ValueError('Pipeline cases are missing or duplicated')
    source = next(r for r in record['cases'] if r['caseKey']=='stored_fact')['checkedProjection']
    claim = source['claims'][0]; evidence = claim['evidence'][0]
    if len(source['claims'])!=1 or len(claim['evidence'])!=1 or claim['type']!='condition' or \
       claim['assertion']!='In 2025, the fictional share was 27.4%.' or claim['periodLabel']!='2025' or \
       evidence['url']!='https://example.org/fictional-table' or \
       evidence['locator']!='series=fictional-share;geography=fictional-country;period=2025':
        raise ValueError('Checked fictional projection differs from its fixed source')
    return {'schemaVersion':1,'evidenceKind':'isolated_fictional_captured_pipeline',
        'recordedAt':record['observedAt'],'liveCollectionEnabled':False,'livePublicationEnabled':False,
        'runtimeVisibilityVerified':False,'externalSourceRequests':0,'displayRollbackVerified':True,
        'cases':accepted,'fact':{'assertion':claim['assertion'],'periodLabel':claim['periodLabel'],
            'publisher':evidence['publisher'],'title':evidence['title'],'url':evidence['url'],
            'locator':evidence['locator'],'retrievedAt':evidence['retrievedAt'],
            'lastEvidenceReviewOn':source['lastEvidenceReviewOn']}}


def main():
    if sys.argv[1:]: raise RuntimeError('Fixed exporter accepts no arguments')
    raw = (PROOF/'PIPELINE_RESULT.json').read_bytes()
    snapshot = build_snapshot(json.loads(raw))
    destination = ROOT/'fixtures/fictional_pipeline_snapshot.json'
    if destination.exists(): raise RuntimeError('Original exported fixture is retained; do not overwrite silently')
    destination.write_text(json.dumps(snapshot,indent=2)+'\n')
    print('Exported three checked fictional whole-update cases and the whitelisted illustrative fact; private control IDs excluded.')
    return 0

if __name__=='__main__': raise SystemExit(main())
