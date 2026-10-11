"""Closed phase receipts for the two invented Request/shared-budget workers."""
import json
import re
from contact_free_node_receipt import BIN, INSPECT_FORMAT

EXPECTED = {'first': ['chain_A_cancel_observation_held', 'chain_A_metadata_ticket_only', 'chain_A_no_recovery_while_physical', 'chain_A_observer_ready', 'chain_A_physical_write_still_owned', 'chain_A_unknown_after_physical_end', 'chain_actual_sql_commit', 'chain_body_owned', 'chain_body_prepared', 'chain_body_retired_before_write', 'chain_handoff_cannot_replay', 'chain_handoff_packet_retired', 'chain_one_physical_write_only', 'chain_opaque_handoff_has_no_body', 'chain_original_admission_bound', 'chain_original_body_already_retired', 'chain_original_body_consumed_once', 'chain_original_body_unread', 'chain_original_operation_bound', 'chain_original_request_bound', 'chain_parent_cancel_signal_observed', 'chain_private_custody_one_body', 'chain_second_body_unread', 'chain_shared_blocks_before_second_body', 'chain_shared_effect_not_yet_settled', 'chain_shared_reserved_first', 'chain_shared_unknown_after_commit', 'chain_sql_arm_after_body_retirement', 'ownership_all_body_leases_retired', 'shared_current_target', 'shared_exact_image', 'shared_exact_label', 'shared_network_none', 'shared_no_ports', 'shared_no_staging_payloads', 'shared_no_staging_records', 'shared_only_owned_mount', 'shared_physical_commands_retired'], 'replacement': ['ownership_all_body_leases_retired', 'replacement_body_unread', 'replacement_count_once', 'replacement_durable_unknown', 'replacement_metadata_no_body', 'replacement_no_second_resolution', 'replacement_no_unknown', 'replacement_original_effect', 'replacement_original_effect_not_replayed', 'replacement_original_received', 'replacement_owner_unused', 'replacement_prebody_held', 'shared_current_target', 'shared_exact_image', 'shared_exact_label', 'shared_network_none', 'shared_no_ports', 'shared_no_staging_payloads', 'shared_no_staging_records', 'shared_only_owned_mount', 'shared_physical_commands_retired']}
EXPECTED = {phase:frozenset(labels) for phase,labels in EXPECTED.items()}


def decode_combined_write_receipt(text,container,phase):
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
        if type(s) is not dict or set(s)!=keys or type(s['schemaVersion']) is not int or s['schemaVersion']!=1 or s['evidenceKind']!='invented_native_combined_write_chain':return None
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
        return {'schemaVersion':1,'evidenceKind':'invented_native_combined_write_chain','phase':s['phase'],**{k:s[k] for k in booleans},'failureLabel':failure,'assertions':assertions,'commands':commands,'ticket':ticket,'actualSourceRequests':0}
    except (ValueError,TypeError,KeyError,OverflowError,RecursionError):return None
