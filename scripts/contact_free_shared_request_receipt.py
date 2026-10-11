"""Closed phase receipts for the two invented Request/shared-budget workers."""
import json
import re
from contact_free_node_receipt import BIN, INSPECT_FORMAT

EXPECTED = {'first': frozenset({'first_core_receipt_excludes_body', 'shared_physical_commands_retired', 'first_actual_native_unicode_prepared', 'cancel_no_new_effect', 'cap_no_new_effect', 'cancel_original_prewrite_release_after_retirement', 'lost_shared_unknown_persists', 'cancel_physical_retired', 'lost_native_prepared', 'first_native_body_unread_at_reservation', 'first_shared_reserved_before_body', 'cap_shared_reserved_before_measurement', 'lost_native_retired', 'shared_exact_label', 'shared_no_ports', 'first_actual_current_custody_confirmed', 'cancel_shared_reservation_still_owned', 'cancel_native_observer_held', 'cancel_second_unused_prewrite_release', 'shared_no_staging_payloads', 'lost_shared_armed', 'first_body_physical_retired', 'cancel_third_worker_body_unread', 'shared_network_none', 'cap_known_prewrite_released', 'cancel_physical_reader_owned', 'first_explicit_metadata_settlement', 'cancel_second_shared_slot_only', 'shared_current_target', 'cap_physical_retired_before_release', 'lost_actual_commit_before_injected_ack_loss', 'shared_no_staging_records', 'shared_exact_image', 'first_shared_effect_counted_once', 'lost_effect_not_yet_counted', 'cap_native_reader_held', 'first_confirmation_keeps_shared_unknown', 'cancel_no_prewrite_release_during_physical', 'shared_only_owned_mount', 'cancel_third_worker_before_body_held', 'first_shared_arm_after_eof'}), 'replacement': frozenset({'replacement_shared_unknown_released', 'shared_physical_commands_retired', 'replacement_after_explicit_resolve_admitted', 'shared_exact_label', 'replacement_repeated_resolution_held', 'shared_no_ports', 'replacement_effect_not_repeat', 'shared_no_staging_payloads', 'replacement_prior_unknown', 'shared_network_none', 'replacement_metadata_excludes_body', 'replacement_new_effect_counted_once', 'replacement_body_unread', 'replacement_explicit_original_effect', 'shared_current_target', 'replacement_unread_prewrite_release', 'shared_no_staging_records', 'shared_exact_image', 'replacement_new_reader_unused', 'replacement_original_received', 'replacement_prebody_shared_gate', 'shared_only_owned_mount'})}


def decode_shared_request_receipt(text,container,phase):
    try:
        if type(text) is not str or len(text.encode('utf-8'))>131072 or phase not in EXPECTED:return None
        def pairs(items):
            result={}
            for k,v in items:
                if k in result:raise ValueError('Duplicate closed field')
                result[k]=v
            return result
        s=json.loads(text,object_pairs_hook=pairs)
        booleans=['completed','proofOwnerVerified','primaryDatabaseTouched','liveIntakeEnabled','hostAuthenticationVerified','actualServiceRestartVerified']
        keys={'schemaVersion','evidenceKind','phase','failureLabel','assertions','commands','ticket','actualSourceRequests',*booleans}
        if type(s) is not dict or set(s)!=keys or type(s['schemaVersion']) is not int or s['schemaVersion']!=1 or s['evidenceKind']!='invented_native_shared_request':return None
        if any(type(s[k]) is not bool for k in booleans) or any(s[k] for k in booleans[2:]):return None
        if type(s['actualSourceRequests']) is not int or s['actualSourceRequests']!=0 or s['phase'] not in (phase,None):return None
        expected=EXPECTED[phase];seen=set();assertions=[]
        if type(s['assertions']) is not list or len(s['assertions'])>len(expected):return None
        for item in s['assertions']:
            if type(item) is not dict or set(item)!={'label','pass'} or type(item['label']) is not str or item['label'] not in expected or item['label'] in seen or type(item['pass']) is not bool:return None
            seen.add(item['label']);assertions.append({'label':item['label'],'pass':item['pass']})
        failed=[a['label'] for a in assertions if a['pass'] is False];failure=s['failureLabel']
        if failure is not None and (type(failure) is not str or failure not in expected) or failed!=([] if failure is None else [failure]):return None
        ticket=s['ticket']
        if ticket is not None and (type(ticket) is not str or not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',ticket)):return None
        if phase=='replacement' and ticket is not None:return None
        inspect=['docker','--host','unix:///var/run/docker.sock','inspect',container,'--format',INSPECT_FORMAT]
        sql=['docker','--host','unix:///var/run/docker.sock','exec','-i',container,BIN+'psql','-h','/tmp','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1']
        commands=[]
        if type(s['commands']) is not list or len(s['commands'])>256:return None
        for item in s['commands']:
            if type(item) is not dict or set(item)!={'command','exitCode','timedOut'} or type(item['command']) is not list or item['command'] not in (inspect,sql) or type(item['timedOut']) is not bool:return None
            code=item['exitCode']
            if code is not None and (type(code) is not int or not 0<=code<=255):return None
            commands.append({'command':list(item['command']),'exitCode':code,'timedOut':item['timedOut']})
        if s['phase'] is None and (assertions or commands or s['proofOwnerVerified'] or ticket is not None):return None
        if s['completed'] and (s['phase']!=phase or seen!=expected or failed or not s['proofOwnerVerified'] or not commands or commands[0]['command']!=inspect or not any(x['command']==sql for x in commands) or any(x['exitCode']!=0 or x['timedOut'] for x in commands) or phase=='first' and ticket is None):return None
        return {'schemaVersion':1,'evidenceKind':'invented_native_shared_request','phase':s['phase'],**{k:s[k] for k in booleans},'failureLabel':failure,'assertions':assertions,'commands':commands,'ticket':ticket,'actualSourceRequests':0}
    except (ValueError,TypeError,KeyError,OverflowError,RecursionError):return None
