"""Closed I supplemental lease witnesses over the unchanged F receipt decoder."""
import json
from contact_free_shared_request_receipt import decode_shared_request_receipt

LABELS = {'first': frozenset({'ownership_first_explicit_physical_retirement',
    'ownership_cap_retired_before_sql_release','ownership_pending_cancel_cannot_retire',
    'ownership_cancel_retired_before_sql_release','ownership_lost_body_retired_without_settling_sql',
    'ownership_all_body_leases_retired'}), 'replacement':frozenset({'ownership_all_body_leases_retired'})}

def decode_body_ownership_receipt(text,container,phase):
    try:
        if type(text) is not str or len(text.encode('utf-8'))>131072 or phase not in LABELS:return None
        def pairs(items):
            values={}
            for key,value in items:
                if key in values:raise ValueError('Duplicate closed field')
                values[key]=value
            return values
        packet=json.loads(text,object_pairs_hook=pairs)
        if type(packet) is not dict or packet.get('evidenceKind')!='invented_native_body_ownership_request' or type(packet.get('assertions')) is not list:return None
        extra=[];base=[];seen=set()
        for item in packet['assertions']:
            if type(item) is not dict or set(item)!={'label','pass'} or type(item['label']) is not str or type(item['pass']) is not bool:return None
            if item['label'] in LABELS[phase]:
                if item['label'] in seen:return None
                seen.add(item['label']);extra.append({'label':item['label'],'pass':item['pass']})
            else:base.append(item)
        original_completed=packet.get('completed');original_failure=packet.get('failureLabel')
        failures=[a['label'] for a in extra if a['pass'] is False]
        if failures and (failures!=[original_failure] or original_completed is not False):return None
        if original_failure in LABELS[phase]:
            if failures != [original_failure]:return None
            packet['failureLabel']=None
        if original_completed is True and (seen!=LABELS[phase] or failures):return None
        packet['evidenceKind']='invented_native_shared_request';packet['assertions']=base
        checked=decode_shared_request_receipt(json.dumps(packet),container,phase)
        if checked is None:return None
        checked['evidenceKind']='invented_native_body_ownership_request'
        checked['assertions'].extend(extra);checked['failureLabel']=original_failure
        return checked
    except (ValueError,TypeError,KeyError,OverflowError,RecursionError):return None
