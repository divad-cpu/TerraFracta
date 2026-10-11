"""Closed H plan metadata, qualified against G snapshots and original continuity.

Pure invented metadata only. No host authenticity, physical retirement, SQL
settlement, copy custody, operational opening or admission restart is proved.
"""
from collections import Counter
import json
from contact_free_write_recovery_trial import check_write_plan,closed_id,integer
DAY=86400000
SAFE=9007199254740991

def same(a,b):
    return json.dumps(a,sort_keys=True,separators=(',',':'))==json.dumps(b,sort_keys=True,separators=(',',':'))

def closed_shared_inventory(value,at):
    try:
        if not integer(at,maximum=SAFE-180*DAY) or type(value) is not dict or set(value)!={'schemaVersion','kind','writeInventory','admission'} or type(value['schemaVersion']) is not int or value['schemaVersion']!=1 or value['kind']!='invented_shared_recovery_inventory':return False
        write=value['writeInventory'];admission=value['admission']
        if type(write) is not dict or type(admission) is not dict or set(admission)!={'acceptedAtMs','addressBuckets','reservations'}:return False
        if any(type(admission[k]) is not list or len(admission[k])>cap for k,cap in [('acceptedAtMs',60),('addressBuckets',400),('reservations',2)]):return False
        if any(not integer(t,maximum=SAFE-180*DAY) or not at-3600000<t<=at for t in admission['acceptedAtMs']):return False
        if len(admission['acceptedAtMs'])+len(admission['reservations'])>60:return False
        # Reuse J's closed record/effect shape, exact expiry and ownership rules.
        if type(write.get('records')) is not list or type(write.get('operations')) is not list:return False
        synthetic={'schemaVersion':1,'kind':'invented_write_backup_inventory','executionId':write.get('executionId'),'copiedAtMs':at,'records':[],'operations':[]}
        projection={'kind':'planned_invented_write_recovery','executionId':write.get('executionId'),'observedAtMs':at,
          'recordActions':[{'reportId':r['lifecycle']['reportId'],'backupVersion':None,'latestRecord':r,'payload':'remove'} for r in write['records']],
          'operationActions':[{'operationId':o['operationId'],'backupOperation':None,'latestOperation':o} for o in write['operations']]}
        if not check_write_plan(projection,synthetic,write,at):return False
        epoch=at//900000;keys=set()
        for bucket in admission['addressBuckets']:
            if type(bucket) is not dict or set(bucket)!={'key','epoch','expiresAtMs','attempts'} or not closed_id(bucket['key']) or bucket['key'] in keys or not integer(bucket['epoch']) or bucket['epoch'] not in (epoch,epoch-1) or not integer(bucket['expiresAtMs']) or bucket['expiresAtMs']!=(bucket['epoch']+2)*900000 or at>=bucket['expiresAtMs'] or type(bucket['attempts']) is not list or len(bucket['attempts'])>5:return False
            times=bucket['attempts']
            if any(not integer(t,maximum=SAFE-180*DAY) or not at-900000<t<=at or t//900000!=bucket['epoch'] for t in times) or times!=sorted(times):return False
            keys.add(bucket['key'])
        tickets=set();operations=set();effects={o['operationId']:o for o in write['operations']}
        for r in admission['reservations']:
            if type(r) is not dict or set(r)!={'ticket','operationId','admittedAtMs','phase','requestId','target'} or not closed_id(r['ticket']) or r['ticket'] in tickets or r['phase'] not in ('reserved','armed','dispatched','expired'):return False
            tickets.add(r['ticket'])
            if r['phase']=='expired':
                if any(r[k] is not None for k in ['operationId','admittedAtMs','requestId','target']):return False
                continue
            if not closed_id(r['operationId']) or r['operationId'] in operations or not integer(r['admittedAtMs'],maximum=SAFE-180*DAY) or not r['admittedAtMs']<=at<r['admittedAtMs']+180*DAY:return False
            operations.add(r['operationId'])
            if (r['phase']=='reserved')!=(r['requestId'] is None) or (r['requestId'] is None)!=(r['target'] is None):return False
            if r['requestId'] is not None:
                from contact_free_write_recovery_trial import closed_target
                if not closed_id(r['requestId']) or not closed_target(r['target']):return False
            effect=effects.get(r['operationId'])
            if effect and (r['phase']!='dispatched' or effect['admittedAtMs']!=r['admittedAtMs'] or effect['requestId']!=r['requestId'] or not same(effect['target'],r['target'])):return False
        return True
    except (KeyError,TypeError,ValueError,OverflowError,RecursionError):return False

def retains_times(prior,present,cutoff):
    counts=Counter(present)
    for t in prior:
        if t>cutoff:
            if counts[t]<=0:return False
            counts[t]-=1
    return True

def check_shared_restore_plan(result,backup,latest,at):
    try:
        if type(result) is dict and result=={'kind':'held'}:return True
        keys={'kind','executionId','observedAtMs','recordActions','operationActions','latestAdmission','admissionHeld','writerEnabled'}
        if type(result) is not dict or set(result)!=keys or result['kind']!='planned_invented_shared_restore' or type(result['observedAtMs']) is not int or result['observedAtMs']!=at or result['admissionHeld'] is not True or result['writerEnabled'] is not False:return False
        if type(backup) is not dict or set(backup)!={'schemaVersion','kind','writeBackup','sharedInventory'} or type(backup['schemaVersion']) is not int or backup['schemaVersion']!=1 or backup['kind']!='invented_shared_backup_inventory':return False
        old_write=backup['writeBackup'];old=backup['sharedInventory'];copied=old_write['copiedAtMs']
        if copied>at or not closed_shared_inventory(old,copied) or not closed_shared_inventory(latest,at):return False
        if result['executionId']!=old_write['executionId'] or old_write['executionId']!=old['writeInventory']['executionId'] or old_write['executionId']!=latest['writeInventory']['executionId']:return False
        ordered=lambda values,key:sorted(values,key=key)
        if not same(ordered([r['record'] for r in old_write['records']],lambda r:r['lifecycle']['reportId']),ordered(old['writeInventory']['records'],lambda r:r['lifecycle']['reportId'])) or not same(ordered(old_write['operations'],lambda o:o['operationId']),ordered(old['writeInventory']['operations'],lambda o:o['operationId'])):return False
        projection={k:result[k] for k in ['executionId','observedAtMs','recordActions','operationActions']};projection['kind']='planned_invented_write_recovery'
        if not check_write_plan(projection,old_write,latest['writeInventory'],at) or not same(result['latestAdmission'],latest['admission']):return False
        a,b=old['admission'],latest['admission']
        if not retains_times(a['acceptedAtMs'],b['acceptedAtMs'],at-3600000):return False
        buckets={v['key']:v for v in b['addressBuckets']}
        for previous in a['addressBuckets']:
            current=buckets.get(previous['key'])
            if current is None:
                if previous['expiresAtMs']>at:return False
            elif previous['epoch']!=current['epoch'] or previous['expiresAtMs']!=current['expiresAtMs'] or not retains_times(previous['attempts'],current['attempts'],at-900000):return False
        reservations={v['ticket']:v for v in b['reservations']};effects={o['operationId']:o for o in latest['writeInventory']['operations']}
        phases={'reserved':0,'armed':1,'dispatched':2,'expired':3}
        for previous in a['reservations']:
            current=reservations.get(previous['ticket'])
            if current is not None:
                if phases[current['phase']]<phases[previous['phase']]:return False
                if current['phase']=='expired':
                    if previous['phase']!='expired' and (previous['admittedAtMs'] is None or at<previous['admittedAtMs']+180*DAY):return False
                elif previous['operationId']!=current['operationId'] or previous['admittedAtMs']!=current['admittedAtMs'] or previous['requestId'] is not None and (previous['requestId']!=current['requestId'] or not same(previous['target'],current['target'])):return False
                continue
            effect=effects.get(previous['operationId'])
            if previous['phase'] in ('reserved','expired') or effect is None or effect['admittedAtMs']!=previous['admittedAtMs'] or effect['requestId']!=previous['requestId'] or not same(effect['target'],previous['target']):return False
        return True
    except (KeyError,TypeError,ValueError,OverflowError,RecursionError):return False

def qualify_captured_shared_inventory(value,execution,at):
    """Close a capture against its original source context before retaining it.

    A G CLI summary qualifies the parsed inventory but omits execution identity;
    it cannot supply this parent binding or authorize retaining extra raw fields.
    """
    return closed_id(execution) and closed_shared_inventory(value,at) and value['writeInventory']['executionId']==execution and value['writeInventory']['observedAtMs']==at
