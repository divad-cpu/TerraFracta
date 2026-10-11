"""Closed phase receipts for the two invented Request/shared-budget workers."""
import json
import re
from contact_free_node_receipt import BIN, INSPECT_FORMAT

EXPECTED = {'first': ['armgap_A_observation_physical_owned', 'armgap_SQL_committed_original_arm', 'armgap_actual_original_nonwrite_fence', 'armgap_body_consumed_once_before_arm', 'armgap_cancelled_observation_held', 'armgap_factory_permanently_held_after_resolution', 'armgap_no_prewrite_release_after_arm', 'armgap_no_prewrite_release_during_arm', 'armgap_no_resolution_during_physical_arm', 'armgap_no_write_after_physical_arm', 'armgap_nonwrite_fence_releases_SQL_debt', 'armgap_nonwrite_has_no_body_or_receipt', 'armgap_nonwrite_never_counts_accepted', 'armgap_nonwrite_resolution_remains_nonacceptance', 'armgap_one_original_resolution_only', 'armgap_original_SQL_debt_retained', 'armgap_original_nonwrite_effect_preserved', 'armgap_original_operation_issued', 'armgap_original_submission_owned', 'armgap_original_ticket_and_request', 'armgap_owned_coordinator_ready', 'armgap_parent_cancel_signal_preserved', 'armgap_physical_arm_still_owned', 'armgap_reserve_before_original_body', 'armgap_resolution_minimal_original_metadata', 'armgap_resolution_owns_original_ticket', 'armgap_resolved_original_cannot_repeat', 'armgap_zero_private_custody', 'bridge_A_physical_write_still_owned', 'bridge_I_original_body_retired', 'bridge_SQL_issued_original_operation', 'bridge_SQL_original_admission', 'bridge_actual_SQL_committed_after_parent_abort', 'bridge_arm_exact_original_request', 'bridge_arm_exact_original_ticket', 'bridge_external_shared_unknown_holds_before_body', 'bridge_local_unknown_body_unread', 'bridge_local_unknown_holds_before_body', 'bridge_never_prewrite_release_after_dispatch', 'bridge_no_prewrite_release_during_physical_write', 'bridge_no_resolution_during_physical_write', 'bridge_one_durable_reservation_per_owned_request', 'bridge_one_physical_write_only', 'bridge_opaque_submission_no_body', 'bridge_original_body_consumed_once_before_arm', 'bridge_original_parent_abort_signal', 'bridge_owned_shared_coordinator_ready', 'bridge_parent_observation_held', 'bridge_physical_SQL_port_still_owned', 'bridge_private_original_body_in_custody', 'bridge_shared_effect_not_yet_settled', 'bridge_shared_reserve_before_original_body', 'bridge_shared_unknown_survives_process', 'bridge_submission_owned_before_port', 'bridge_unknown_after_owned_physical_completion', 'bridge_write_exact_original_ticket', 'bridge_write_exact_prepared_packet', 'ownership_all_body_leases_retired', 'prewrite_SQL_release_only_after_own_native_cancel', 'prewrite_SQL_release_only_original_ticket', 'prewrite_SQL_reservation_gone_after_own_retirement', 'prewrite_SQL_reservation_still_owned', 'prewrite_SQL_reserved_before_read', 'prewrite_explicit_own_retirement_then_SQL_release', 'prewrite_known_factory_capacity_reusable', 'prewrite_native_cancel_cannot_retire_SQL', 'prewrite_native_observer_held', 'prewrite_no_new_accepted_effect', 'prewrite_no_release_during_physical_cancel', 'prewrite_original_native_body_unread_at_begin', 'prewrite_original_physical_cancel_owned', 'reservegap_SQL_debt_removed_only_after_release', 'reservegap_actual_native_deadline_elapsed', 'reservegap_body_unread_after_late_reply', 'reservegap_body_unread_at_observer_timeout', 'reservegap_explicit_late_own_prewrite_retirement', 'reservegap_late_actual_SQL_admission', 'reservegap_no_accepted_effect', 'reservegap_no_body_write', 'reservegap_no_release_port_during_physical', 'reservegap_no_release_while_physical_port', 'reservegap_observer_deadline_held', 'reservegap_one_original_release_only', 'reservegap_own_factory_retired_without_restart', 'reservegap_owned_coordinator_ready', 'reservegap_physical_reserve_still_owned', 'reservegap_release_exact_late_original_ticket', 'reservegap_release_only_after_physical_end', 'shared_current_target', 'shared_exact_image', 'shared_exact_label', 'shared_network_none', 'shared_no_ports', 'shared_no_staging_payloads', 'shared_no_staging_records', 'shared_only_owned_mount', 'shared_physical_commands_retired'], 'replacement': ['ownership_all_body_leases_retired', 'replacement_body_unread', 'replacement_count_once', 'replacement_durable_unknown', 'replacement_metadata_no_body', 'replacement_no_second_resolution', 'replacement_no_unknown', 'replacement_original_effect', 'replacement_original_effect_not_replayed', 'replacement_original_received', 'replacement_owner_unused', 'replacement_prebody_held', 'shared_current_target', 'shared_exact_image', 'shared_exact_label', 'shared_network_none', 'shared_no_ports', 'shared_no_staging_payloads', 'shared_no_staging_records', 'shared_only_owned_mount', 'shared_physical_commands_retired']}
EXPECTED['replacement'].extend(['targetgap_reserve_before_original_body', 'targetgap_original_operation_issued', 'targetgap_original_body_consumed_before_arm', 'targetgap_original_ticket_and_request', 'targetgap_actual_SQL_armed', 'targetgap_target_retired_after_arm', 'targetgap_write_exact_original_packet', 'targetgap_write_exact_original_ticket', 'targetgap_B_transaction_known_nonwrite', 'targetgap_nonwrite_has_no_body_receipt', 'targetgap_resolution_minimal_original_metadata', 'targetgap_resolution_owns_original_ticket', 'targetgap_resolution_original_nonwrite', 'targetgap_owned_coordinator_ready', 'targetgap_original_submission_owned', 'targetgap_refusal_observation_held', 'targetgap_one_arm_and_write_only', 'targetgap_no_physical_work_after_reply', 'targetgap_no_automatic_shared_settlement', 'targetgap_SQL_nonwrite_debt_retained', 'targetgap_no_new_accepted_or_open_effect', 'targetgap_zero_staging_rows', 'targetgap_no_original_private_record', 'targetgap_immutable_original_nonwrite_fence', 'targetgap_armed_refusal_cannot_release_prewrite', 'targetgap_no_prewrite_release_port', 'targetgap_explicit_resolution_remains_nonacceptance', 'targetgap_one_original_resolution_only', 'targetgap_known_resolution_releases_SQL_debt', 'targetgap_global_counts_unchanged', 'targetgap_factory_held_after_resolution', 'targetgap_held_factory_cannot_reopen', 'targetgap_held_new_body_unread', 'targetgap_no_second_resolution', 'targetgap_original_SQL_ticket_cannot_write_again'])
EXPECTED['first'].remove('ownership_all_body_leases_retired')
EXPECTED['replacement'].remove('ownership_all_body_leases_retired')
EXPECTED['first'].extend(['bridge_actual_owned_body_leases_retired', 'bridge_actual_prepared_handoffs_claimed'])
EXPECTED['replacement'].extend(['targetgap_actual_owned_body_leases_retired', 'targetgap_actual_prepared_handoffs_claimed'])
EXPECTED['replacement'].remove('replacement_owner_unused')
EXPECTED['first'].extend(['prewrite_actual_body_lease_retained_during_cancel', 'prewrite_actual_body_lease_removed_after_own_retirement'])
EXPECTED = {phase:frozenset(labels) for phase,labels in EXPECTED.items()}


def _decode_shared_write_receipt(text,container,phase,expected_by_phase,evidence_kind):
    try:
        if type(text) is not str or len(text.encode('utf-8'))>131072 or phase not in expected_by_phase:return None
        def pairs(items):
            result={}
            for k,v in items:
                if k in result:raise ValueError('Duplicate closed field')
                result[k]=v
            return result
        s=json.loads(text,object_pairs_hook=pairs)
        booleans=['completed','proofOwnerVerified','primaryDatabaseTouched','liveIntakeEnabled','hostAuthenticationVerified','actualServiceRestartVerified']
        keys={'schemaVersion','evidenceKind','phase','failureLabel','assertions','commands','ticket','actualSourceRequests',*booleans}
        if type(s) is not dict or set(s)!=keys or type(s['schemaVersion']) is not int or s['schemaVersion']!=1 or s['evidenceKind']!=evidence_kind:return None
        if any(type(s[k]) is not bool for k in booleans) or any(s[k] for k in booleans[2:]):return None
        if type(s['actualSourceRequests']) is not int or s['actualSourceRequests']!=0 or s['phase'] not in (phase,None):return None
        expected=expected_by_phase[phase];seen=set();assertions=[]
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
        return {'schemaVersion':1,'evidenceKind':evidence_kind,'phase':s['phase'],**{k:s[k] for k in booleans},'failureLabel':failure,'assertions':assertions,'commands':commands,'ticket':ticket,'actualSourceRequests':0}
    except (ValueError,TypeError,KeyError,OverflowError,RecursionError):return None


def decode_shared_write_receipt(text,container,phase):
    return _decode_shared_write_receipt(text,container,phase,EXPECTED,
        'invented_native_shared_write_chain')
