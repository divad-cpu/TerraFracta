"""Fresh invented worker-composition proof, with no new SQL or privileges.

The old custodian owns a newly created networkless cluster. Restricted NOLOGIN
roles are simulated with controlled administrator SET SESSION AUTHORIZATION;
this proves neither login nor arbitrary-SQL containment nor operational trust.
"""
from __future__ import annotations
import ast
from dataclasses import replace
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import sys
from scripts.rehearse_postgres_feed_journal import FreshFeedPostgres, FeedPgTrialError
from scripts.rehearse_stream_reader import freeze_all, prepare
from scripts.rehearse_document_reference import freeze_reference, install_reference, reference_profile
from scripts.rehearse_stream_reader_restore import private_defaults
from scripts.rehearse_collection_reader import snapshot, read
from scripts.rehearse_feed_runtime_roles import OwnedRuntimeRoles
from workers.bounded_worker_process import WorkerOutput
from workers.feed_collection_inventory import prepare_inventory_request
from workers.feed_postgres_contract import committed_pg_json, COMMIT_MARKER
from workers.document_result_contract import invented_document_result_read_statement
from workers.retained_document_reader import read_retained_document, RetainedDocumentReadError
from workers.reopened_document_change import prepare_reopened_document_change
from workers.document_passage_comparison import compare_document_passages
from workers.pair_native_sql import _literal
ROOT = Path(__file__).resolve().parents[1]
ROUTES = ('collection_inventory', 'document_reference', 'feed_original', 'page_receipt',
    'item_history', 'document_original', 'document_result_receipt')


def freeze_worker(trial):
    names = {'scripts/rehearse_retained_document_reader.py', 'workers/retained_document_reader.py'}
    queue = list(names)
    while queue:
        name = queue.pop()
        for node in ast.walk(ast.parse((ROOT/name).read_bytes())):
            if isinstance(node, ast.ImportFrom) and node.module:
                child = node.module.replace('.', '/')+'.py'
                if child not in names and child not in trial.frozen and (ROOT/child).is_file():
                    names.add(child); queue.append(child)
    rows = []
    for name in sorted(names):
        raw = (ROOT/name).read_bytes()
        if name in trial.frozen:
            if trial.frozen[name] != raw: raise FeedPgTrialError('Retained reader dependency changed')
            continue
        path = trial.proof/'inputs'/name; path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with path.open('xb') as stream: stream.write(raw)
        path.chmod(0o600); trial.frozen[name] = raw
        row = dict(path=name, bytes=len(raw), sha256=sha256(raw).hexdigest())
        rows.append(row); trial.source_bindings.append(row)
    trial.record('RETAINED_WORKER_SOURCE_BINDINGS', rows)
    trial.record('RETAINED_WORKER_SCOPE', dict(sevenFixedReads=True, newSQL=False,
        newGrants=False, automaticBaseline=False, sourceRequests=0, modelCalls=0,
        sameOwnedInventedOnly=True, operationalAcceptance=False, primaryChanged=False))


class RestrictedPort:
    def __init__(self, trial, roles, label, *, remove_marker_at=None):
        if type(roles) is not OwnedRuntimeRoles or roles.trial is not trial:
            raise FeedPgTrialError('Retained reader port custodian mismatch')
        self.trial = trial; self.roles = roles; self.label = label; self.calls = []
        self.remove_marker_at = remove_marker_at

    def __call__(self, sql):
        # Only the new worker supplies this statement; this test port is not an
        # application connection factory or an arbitrary user SQL endpoint.
        output = self.roles.query('tf_feed_lab_observer', sql, allowed=True)
        index = len(self.calls)+1
        self.calls.append(dict(index=index, statementSha256=sha256(sql.encode()).hexdigest(),
            stdoutBytes=len(output.stdout), stdoutSha256=sha256(output.stdout).hexdigest(),
            stderrBytes=len(output.stderr), returncode=output.returncode,
            route=next((route for route in ROUTES if 'select tf_feed_runtime.'+route+'(' in sql), None)))
        self.trial.record(self.label+'_QUERY_'+str(index), self.calls[-1])
        stdout = output.stdout
        if self.remove_marker_at == index:
            if not stdout.endswith(b'\n'+COMMIT_MARKER+b'\n'): raise FeedPgTrialError('Fault source marker absent')
            stdout = stdout[:-(len(COMMIT_MARKER)+1)]
            self.trial.record(self.label+'_INJECTED_UNCOMMITTED_DELIVERY',
                dict(index=index, bytes=len(stdout), sha256=sha256(stdout).hexdigest()))
        return WorkerOutput(stdout, output.stderr, output.returncode)


def invoke(trial, roles, label, independent, *, remove_marker_at=None):
    scope, binding, mapping, association = independent
    port = RestrictedPort(trial, roles, label, remove_marker_at=remove_marker_at)
    result = read_retained_document(prepare_inventory_request(scope, item_limit=20),
        binding=binding, mapping=mapping, association=association, query=port,
        utc_now=lambda: datetime.now(timezone.utc))
    trial.record(label+'_COMPLETE', dict(status=result.status, queryCount=result.query_count,
        observedRoutes=[call['route'] for call in port.calls],
        artifact=None if result.stored is None else result.stored.artifact_id))
    return result, port


def refused(trial, roles, label, independent, count, *, remove_marker_at=None):
    before = snapshot(trial)
    scope, binding, mapping, association = independent
    port = RestrictedPort(trial, roles, label, remove_marker_at=remove_marker_at)
    try:
        read_retained_document(prepare_inventory_request(scope, item_limit=20), binding=binding,
            mapping=mapping, association=association, query=port, utc_now=lambda: datetime.now(timezone.utc))
    except RetainedDocumentReadError as error:
        trial.check(label+'_curated_refusal_and_no_later_read', len(port.calls) == count
            and str(error) in ('retained_document_read_unavailable', 'retained_document_outside_selected_page'))
    else: raise FeedPgTrialError('Expected retained worker refusal absent')
    trial.check(label+'_all_nine_rows_exact', snapshot(trial) == before)


def cases(trial):
    roles, independent, foreign_scope, foreign, later = prepare(trial)
    install_reference(trial, roles)
    scope, binding, mapping, association = independent
    access = reference_profile(trial.query); defaults = private_defaults(trial.query)
    trial.record('RETAINED_WORKER_INITIAL_ACCESS', access)
    trial.record('RETAINED_WORKER_INITIAL_DEFAULTS', defaults)
    refused(trial, roles, 'worker_unassigned_metadata', independent, 1)
    trial.query('insert into tf_feed_runtime.allowed_collections values('+_literal(scope.collection_id)+'::uuid);')
    refused(trial, roles, 'worker_metadata_only_no_raw_assignment', independent, 2)
    inventory, raw = read(roles, prepare_inventory_request(scope, item_limit=20))
    selected = next(row for row in inventory.rows if row.item_id == association.feed_item_id)
    pending = next(row for row in inventory.rows if row.item_id != association.feed_item_id)
    trial.query('insert into tf_feed_runtime.allowed_streams values('+_literal(selected.stream_id)+'::uuid);')
    before = snapshot(trial); trial.stop(); trial.start(); roles.verify()
    result, port = invoke(trial, roles, 'worker_cold_seven', independent)
    trial.check('new_worker_exact_seven_native_routes_after_restart', result.query_count == 7
        and [call['route'] for call in port.calls] == list(ROUTES) and snapshot(trial) == before)
    expected = result.reopened.result_request
    original = expected.document_raw
    trial.check('new_worker_actual_original_hash_and_exact_selected_span', sha256(original).hexdigest() == binding.content_sha256
        and result.stored.result.snapshot.passages[0].text == '  Exact Å source passage.')
    owner = trial.query(invented_document_result_read_statement(expected))
    owner_raw = committed_pg_json(owner.stdout, owner.stderr, owner.returncode)
    trial.check('new_worker_complete_receipt_exact_existing_owner_projection', owner_raw == result.full_receipt)
    # The caller explicitly selects the same retained version on both sides.
    # The worker itself makes no first-observation or baseline decision.
    paired = prepare_reopened_document_change(result.reopened, result.full_receipt,
        result.reopened, result.full_receipt, observed_at=datetime.now(timezone.utc))
    compared = compare_document_passages(paired.current, paired.previous, observed_at=datetime.now(timezone.utc))
    trial.check('new_worker_result_handoff_revalidates_no_selected_change', compared.selection.state == 'no_model_work'
        and compared.selection.payload is None)
    trial.record('RETAINED_WORKER_EXPLICIT_SAME_VERSION_HANDOFF', dict(modelCalls=0, requestBody=None, baselineChosenByWorker=False))
    # A later exact occurrence has no stored document. Its explicit absence says
    # nothing about the older version or the validity of proposed binding data.
    pending_association = replace(association, feed_operation_id=pending.capture_operation_id, feed_item_id=pending.item_id)
    pending_inputs = (scope, binding, mapping, pending_association)
    refused(trial, roles, 'worker_pending_raw_scope_not_inherited', pending_inputs, 2)
    trial.query('insert into tf_feed_runtime.allowed_streams values('+_literal(pending.stream_id)+'::uuid);')
    after_assignment = snapshot(trial)
    absent, port = invoke(trial, roles, 'worker_exact_occurrence_absence', pending_inputs)
    trial.check('new_worker_absence_two_reads_no_original_or_global_history_claim', absent.status == 'absent_for_selected_occurrence'
        and absent.query_count == 2 and absent.reopened is None and absent.stored is None
        and snapshot(trial) == after_assignment)
    refused(trial, roles, 'worker_foreign_collection', (foreign_scope, foreign.request.binding,
        foreign.request.mapping, foreign.request.association), 1)
    wrong = replace(association, feed_operation_id=pending.capture_operation_id)
    refused(trial, roles, 'worker_independent_parent_mismatch', (scope, binding, mapping, wrong), 1)
    wrong_binding = replace(binding, language_code='nb')
    wrong_mapping = replace(mapping, language_code='nb')
    refused(trial, roles, 'worker_candidate_not_independent_trust', (scope, wrong_binding, wrong_mapping, association), 2)
    for index in (3, 6, 7):
        refused(trial, roles, 'worker_incomplete_delivery_at_'+str(index), independent, index, remove_marker_at=index)
    trial.query('delete from tf_feed_runtime.allowed_streams where stream_id='+_literal(selected.stream_id)+'::uuid;')
    refused(trial, roles, 'worker_current_stream_revoked', independent, 2)
    trial.query('insert into tf_feed_runtime.allowed_streams values('+_literal(selected.stream_id)+'::uuid);')
    trial.query('delete from tf_feed_runtime.allowed_collections where collection_id='+_literal(scope.collection_id)+'::uuid;')
    refused(trial, roles, 'worker_current_metadata_revoked', independent, 1)
    trial.query('insert into tf_feed_runtime.allowed_collections values('+_literal(scope.collection_id)+'::uuid);')
    before = snapshot(trial); trial.stop(); trial.start(); roles.verify()
    final, port = invoke(trial, roles, 'worker_restarted_seven', independent)
    trial.check('new_worker_final_restart_original_and_receipt_exact', final.full_receipt == result.full_receipt
        and final.reopened.result_request.document_raw == original and snapshot(trial) == before)
    final_access = reference_profile(trial.query); final_defaults = private_defaults(trial.query)
    trial.record('RETAINED_WORKER_FINAL_ACCESS', final_access)
    trial.record('RETAINED_WORKER_FINAL_DEFAULTS', final_defaults)
    trial.check('new_worker_no_sql_acl_default_role_change', final_access == access and final_defaults == defaults)
    return dict(queriesPerConfirmed=7, queriesPerAbsence=2, newSQL=0, newGrants=0,
        automaticBaseline=False, sourceRequests=0, modelCalls=0, operationalAcceptance=False)


def main():
    if sys.argv[1:]: raise FeedPgTrialError('Fixed invented retained worker trial takes no arguments')
    os.umask(0o077); trial = FreshFeedPostgres()
    try:
        freeze_all(trial); freeze_reference(trial); freeze_worker(trial)
        trial.create(); scope = cases(trial)
        trial.record('RETAINED_WORKER_RESULT', dict(state='PASS_INVENTED_RETAINED_WORKER',
            assertions=trial.assertions, assertionCount=len(trial.assertions), scope=scope, primaryChanged=False))
    except BaseException as error:
        trial.record('RETAINED_WORKER_FAILED', dict(type=type(error).__name__, message='invented_retained_worker_failed'))
        raise
    finally:
        try: trial.stop()
        finally:
            try: trial.stop_initializer()
            finally: trial.verify_sources('FINAL_RETAINED_WORKER')
        if trial.identity is not None: trial.record('RETAINED_WORKER_FINAL_OWNED_STATE', trial.inspect())
    print(json.dumps(dict(proof=str(trial.proof), assertions=len(trial.assertions),
        state='PASS_INVENTED_RETAINED_WORKER', primaryChanged=False)))


if __name__ == '__main__': main()
