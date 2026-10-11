-- Invented newest shared/custody recovery inventory after four frozen schemas.
-- Custodian maintenance only; never installer, real authentication or restart.
create role tf_shared_inventory nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
create schema tf_shared_inventory_trial authorization tf_bound_owner;
revoke all on schema tf_shared_inventory_trial from public;
grant execute on function tf_contact_free_trial.sweep_private() to tf_bound_owner;
-- Reuse B's owner-scoped locking pattern instead of ordinary UPDATE grants.
set role tf_trial_owner;
create function tf_contact_free_trial.shared_inventory_lock() returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
begin
 lock table tf_contact_free_trial.records,tf_contact_free_trial.payloads in share mode;
 return true;
end $$;
reset role;
revoke all on function tf_contact_free_trial.shared_inventory_lock() from public;
grant execute on function tf_contact_free_trial.shared_inventory_lock() to tf_bound_owner;
set role tf_bound_owner;
create function tf_shared_inventory_trial.capture_invented(e uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare at_ms bigint;effect jsonb;
begin
 at_ms:=tf_shared_admission_trial.lock_context(e);
 if at_ms is null then return '{"kind":"held"}';end if;
 perform tf_contact_free_trial.shared_inventory_lock();
 lock table tf_contact_free_write_trial.operations,tf_bound_trial.current_targets in share mode;
 effect:=tf_contact_free_trial.sweep_private();
 if effect->>'kind'<>'swept' then return '{"kind":"held"}';end if;
 effect:=tf_contact_free_write_trial.expire_operations();
 if effect->>'kind'<>'expired_operations' then return '{"kind":"held"}';end if;
 -- Same context/clock locks as E; table share locks preserve custody and ledger
 -- through the one captured metadata statement, including concurrent reviewers.
 if (select count(*) from tf_contact_free_trial.records)>200
  or (select count(*) from tf_contact_free_write_trial.operations)>400
  or (select count(*) from tf_shared_admission_trial.buckets)>400
  or (select count(*) from tf_shared_admission_trial.accepted)>60
  or (select count(*) from tf_shared_admission_trial.reservations)>2 then return '{"kind":"held"}';end if;
 return jsonb_build_object('schemaVersion',1,'kind','invented_shared_recovery_inventory',
 'writeInventory',jsonb_build_object('schemaVersion',1,'kind','invented_write_latest_inventory',
  'executionId',e,'known',true,'complete',true,'observedAtMs',at_ms,
  'records',coalesce((select jsonb_agg(jsonb_build_object('lifecycle',jsonb_build_object('schemaVersion',1,
    'reportId',r.report_id,'receivedAtMs',r.received_at_ms,'closedAtMs',r.closed_at_ms,'erasedAtMs',r.erased_at_ms,'eraseReason',r.erase_reason),
    'requestId',r.request_id,'target',r.target,'closedReason',r.closed_reason,'reviewerId',r.reviewer_id,'version',r.version) order by r.report_id)
   from tf_contact_free_trial.records r),'[]'::jsonb),
  'operations',coalesce((select jsonb_agg(jsonb_build_object('operationId',o.operation_id,'executionId',o.execution_id,
    'requestId',o.request_id,'target',o.target,'admittedAtMs',o.admitted_at_ms,'expiresAtMs',o.expires_at_ms,
    'state',o.state,'reportId',o.report_id,'inserted',o.inserted) order by o.operation_id)
   from tf_contact_free_write_trial.operations o),'[]'::jsonb)),
 'admission',jsonb_build_object(
  'acceptedAtMs',coalesce((select jsonb_agg(a.observed_at_ms order by a.observed_at_ms) from tf_shared_admission_trial.accepted a),'[]'::jsonb),
  'addressBuckets',coalesce((select jsonb_agg(jsonb_build_object('key',b.key,'epoch',b.epoch,'expiresAtMs',b.expires_at_ms,'attempts',b.attempts) order by b.key)
    from tf_shared_admission_trial.buckets b),'[]'::jsonb),
  'reservations',coalesce((select jsonb_agg(jsonb_build_object('ticket',r.ticket,'operationId',r.operation_id,
    'admittedAtMs',r.admitted_at_ms,'phase',r.phase,'requestId',r.request_id,'target',r.target) order by r.ticket)
    from tf_shared_admission_trial.reservations r),'[]'::jsonb)));
exception when others then return '{"kind":"held"}';
end $$;
reset role;
revoke all on all functions in schema tf_shared_inventory_trial from public;
grant usage on schema tf_shared_inventory_trial to tf_shared_inventory;
grant execute on function tf_shared_inventory_trial.capture_invented(uuid) to tf_shared_inventory;
-- No ordinary owner switch, private payload, table or admission/write grant.
