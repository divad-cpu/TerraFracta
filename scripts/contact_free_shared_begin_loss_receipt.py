"""Closed phase receipts for the two invented Request/shared-budget workers."""
import json
import re
from contact_free_node_receipt import BIN, INSPECT_FORMAT

EXPECTED = {'first': ['begin_actual_SQL_committed_before_ack_loss', 'begin_actual_SQL_reserve_before_original_body', 'begin_actual_SQL_reserved_original_operation', 'begin_blocked_body_unread', 'begin_durable_reserved_after_lost_ack', 'begin_lost_admission_observation_held', 'begin_no_arm_call', 'begin_no_durable_accepted_effect', 'begin_no_physical_body_started', 'begin_no_physical_write_started', 'begin_no_release_port_call', 'begin_no_resolution_port_call', 'begin_no_unknown_prewrite_release', 'begin_no_unknown_write_resolution', 'begin_no_write_call', 'begin_one_reserve_call_no_retry', 'begin_opaque_submission_owned', 'begin_original_body_remains_unread', 'begin_owned_coordinator_ready', 'begin_physical_admission_port_ended', 'begin_unknown_local_debt_retained', 'begin_unknown_same_factory_held', 'ownership_all_body_leases_retired', 'shared_current_target', 'shared_exact_image', 'shared_exact_label', 'shared_network_none', 'shared_no_ports', 'shared_no_staging_payloads', 'shared_no_staging_records', 'shared_only_owned_mount', 'shared_physical_commands_retired'], 'replacement': ['begin_replacement_empty_custody', 'begin_replacement_empty_effect_ledger', 'begin_replacement_held_global_open_and_hour', 'begin_replacement_no_invented_write_effect', 'begin_replacement_no_third_shared_slot', 'begin_replacement_only_second_shared_slot', 'begin_replacement_original_debt_not_cleared', 'begin_replacement_original_pending_debt', 'begin_replacement_original_reserved_phase', 'begin_replacement_own_body_never_read', 'begin_replacement_release_only_own_unused_slot', 'ownership_all_body_leases_retired', 'shared_current_target', 'shared_exact_image', 'shared_exact_label', 'shared_network_none', 'shared_no_ports', 'shared_no_staging_payloads', 'shared_no_staging_records', 'shared_only_owned_mount', 'shared_physical_commands_retired']}
EXPECTED['first'].remove('ownership_all_body_leases_retired')
EXPECTED['replacement'].remove('ownership_all_body_leases_retired')
EXPECTED['first'].extend(['begin_actual_body_lease_never_started', 'begin_actual_prepared_handoff_never_issued'])
EXPECTED = {phase:frozenset(labels) for phase,labels in EXPECTED.items()}


def decode_shared_begin_loss_receipt(text,container,phase):
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
        if type(s) is not dict or set(s)!=keys or type(s['schemaVersion']) is not int or s['schemaVersion']!=1 or s['evidenceKind']!='invented_native_shared_begin_ack_loss':return None
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
        if ticket is not None:return None
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
        if s['completed'] and (s['phase']!=phase or seen!=expected or failed or not s['proofOwnerVerified'] or not commands or commands[0]['command']!=inspect or not any(x['command']==sql for x in commands) or any(x['exitCode']!=0 or x['timedOut'] for x in commands)):return None
        return {'schemaVersion':1,'evidenceKind':'invented_native_shared_begin_ack_loss','phase':s['phase'],**{k:s[k] for k in booleans},'failureLabel':failure,'assertions':assertions,'commands':commands,'ticket':ticket,'actualSourceRequests':0}
    except (ValueError,TypeError,KeyError,OverflowError,RecursionError):return None
