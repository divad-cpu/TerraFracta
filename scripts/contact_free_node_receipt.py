"""Closed invented child receipt decoder; shape is not host authentication."""
import json

EXPECTED_ASSERTIONS = frozenset(['node_absence_fence_no_report', 'node_absence_fence_not_counted', 'node_absence_fence_quota_released', 'node_absence_fence_resolves_nonwrite', 'node_absence_stage_payloads', 'node_absence_stage_records', 'node_ack_loss_actual_custody_unchanged', 'node_ack_loss_actual_record_committed', 'node_ack_loss_body_remains_unread', 'node_ack_loss_new_body_held', 'node_ack_loss_no_write_retry', 'node_ack_loss_one_recovery', 'node_ack_loss_original_effect_counted_once', 'node_ack_loss_quota_unknown', 'node_ack_loss_recovery_confirmed', 'node_ack_loss_recovery_metadata_only', 'node_ack_loss_stage_payloads', 'node_ack_loss_stage_records', 'node_actual_close_bound_payload_removed', 'node_actual_closure', 'node_actual_custody_record_expiry', 'node_actual_operation_expiry', 'node_all_physical_commands_retired', 'node_cancel_actual_custody', 'node_cancel_explicit_recovery', 'node_cancel_original_write_only', 'node_cancel_stage_payloads', 'node_cancel_stage_records', 'node_closed_original_received_not_renewed', 'node_closed_payload_recovery_original_effect', 'node_closed_recovery_has_no_payload', 'node_closed_recovery_keeps_payload_deleted', 'node_closed_recovery_original_admission', 'node_closed_stage_payloads', 'node_closed_stage_records', 'node_exact_image', 'node_exact_label', 'node_final_private_counts', 'node_fixture_current_target', 'node_injected_commit_ack_loss_is_held', 'node_late_server_write_blocked_by_fence', 'node_late_sql_success_does_not_settle', 'node_missing_ack_before_sql_held', 'node_native_eof_cannot_override_retired_sql_target', 'node_native_request_sql_confirmed', 'node_network_none', 'node_no_published_ports', 'node_normal_budget_counted_once', 'node_normal_open_count_matches_custody', 'node_normal_stage_payloads', 'node_normal_stage_records', 'node_only_owned_mount', 'node_original_metadata_deadline_holds', 'node_owned_container_name', 'node_owned_new_mount_path', 'node_parent_abort_held', 'node_parent_abort_physical_owned', 'node_parent_abort_recovery_waits_physical', 'node_parent_abort_unknown_quota', 'node_receipt_excludes_private_text', 'node_repeat_stage_payloads', 'node_repeat_stage_records', 'node_repeated_effect_not_new_count', 'node_repeated_effect_one_custody', 'node_repeated_request_confirmed', 'node_repeated_request_original_report', 'node_retired_stage_payloads', 'node_retired_stage_records', 'node_retired_target_known_nonwrite_released', 'node_retired_target_no_custody', 'node_retired_target_no_new_count', 'node_trial_ready_absent', 'node_trial_ready_canceled', 'node_trial_ready_lost', 'node_trial_ready_normal', 'node_trial_ready_retained', 'node_trial_ready_stale', 'node_write_original_admission'])
ROOT_KEYS = {'schemaVersion','evidenceKind','completed','failureLabel','assertions','commands',
             'injectedAckLoss','parentCanceledWithPhysicalSql','primaryDatabaseTouched',
             'actualSourceRequests','liveIntakeEnabled','hostAuthenticationVerified'}
BIN = '/nix/var/nix/profiles/default/bin/'
INSPECT_FORMAT = '{"image":{{json .Image}},"labels":{{json .Config.Labels}},"network":{{json .HostConfig.NetworkMode}},"ports":{{json .NetworkSettings.Ports}},"mounts":{{json .Mounts}}}'


def decode_invented_node_receipt(text, container):
    # Rebuild only closed metadata. Never preserve an unvalidated child string,
    # arbitrary label/error/command or extra key as evidence.
    try:
        if type(text) is not str or len(text.encode('utf-8')) > 131072:
            return None
        def pairs(items):
            result = {}
            for key, value in items:
                if key in result:
                    raise ValueError('Duplicate closed field')
                result[key] = value
            return result
        source = json.loads(text, object_pairs_hook=pairs)
        if type(source) is not dict or set(source) != ROOT_KEYS:
            return None
        if type(source['schemaVersion']) is not int or source['schemaVersion'] != 1:
            return None
        if source['evidenceKind'] != 'invented_native_request_admission_sql_recovery':
            return None
        booleans = ['completed','injectedAckLoss','parentCanceledWithPhysicalSql','primaryDatabaseTouched','liveIntakeEnabled','hostAuthenticationVerified']
        if any(type(source[key]) is not bool for key in booleans):
            return None
        if (source['primaryDatabaseTouched'] or source['liveIntakeEnabled'] or source['hostAuthenticationVerified'] or
                type(source['actualSourceRequests']) is not int or source['actualSourceRequests'] != 0):
            return None
        if type(source['assertions']) is not list or len(source['assertions']) > len(EXPECTED_ASSERTIONS):
            return None
        assertions = []
        seen = set()
        for item in source['assertions']:
            if type(item) is not dict or set(item) != {'label','pass'} or type(item['label']) is not str or item['label'] not in EXPECTED_ASSERTIONS or type(item['pass']) is not bool or item['label'] in seen:
                return None
            seen.add(item['label']); assertions.append({'label':item['label'],'pass':item['pass']})
        failure = source['failureLabel']
        if failure is not None and (type(failure) is not str or failure not in EXPECTED_ASSERTIONS):
            return None
        failures = [item['label'] for item in assertions if item['pass'] is False]
        if failure is None and failures or failure is not None and failures != [failure]:
            return None
        inspect = ['docker','--host','unix:///var/run/docker.sock','inspect',container,'--format',INSPECT_FORMAT]
        sql = ['docker','--host','unix:///var/run/docker.sock','exec','-i',container,BIN+'psql','-h','/tmp','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1']
        if type(source['commands']) is not list or len(source['commands']) > 256:
            return None
        commands = []
        for item in source['commands']:
            if type(item) is not dict or set(item) != {'command','exitCode','timedOut'} or type(item['command']) is not list or item['command'] not in (inspect,sql) or type(item['timedOut']) is not bool:
                return None
            code = item['exitCode']
            if code is not None and (type(code) is not int or not 0 <= code <= 255):
                return None
            commands.append({'command':list(item['command']),'exitCode':code,'timedOut':item['timedOut']})
        if (source['injectedAckLoss'] or source['parentCanceledWithPhysicalSql']) and not any(item['command'] == sql for item in commands):
            return None
        if source['completed'] and (failure is not None or seen != EXPECTED_ASSERTIONS or failures or not commands or
                not source['injectedAckLoss'] or not source['parentCanceledWithPhysicalSql'] or
                any(item['exitCode'] != 0 or item['timedOut'] for item in commands)):
            return None
        return {'schemaVersion':1,'evidenceKind':'invented_native_request_admission_sql_recovery',
                **{key:source[key] for key in booleans},'failureLabel':failure,'assertions':assertions,
                'commands':commands,'actualSourceRequests':0}
    except (ValueError, TypeError, KeyError, OverflowError, RecursionError):
        return None
