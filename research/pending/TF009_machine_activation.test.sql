\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TF_ACTIVATION_CONTROL_OVERLAY
-- TF_ACTIVATION_CONTROL_STAGE
create temporary table checked_activation(response jsonb not null);
-- TF_ACTIVATION_CONTROL_CALL

select ok(relrowsecurity,'Activation receipts have RLS') from pg_class
 where oid='terra_private.machine_publication_activations'::regclass;
select ok(not prosecdef,'Activation preserves invoker privileges') from pg_proc
 where oid='terra_private.activate_machine_publication(uuid,uuid,uuid,text,uuid,text)'::regprocedure;
select ok(not has_function_privilege(role_name,
 'terra_private.activate_machine_publication(uuid,uuid,uuid,text,uuid,text)','EXECUTE'),
 role_name||' has no activation authority')
 from unnest(array['anon','authenticated','service_role','terra_collector','terra_operator',
                   'terra_reviewer','terra_issue_reader']) roles(role_name);
select ok(not has_table_privilege(role_name,'terra_private.machine_publication_activations','INSERT'),
 role_name||' cannot insert activation receipts')
 from unnest(array['anon','authenticated','service_role','terra_collector','terra_operator',
                   'terra_reviewer','terra_issue_reader']) roles(role_name);
select ok(not exists(select 1 from pg_proc p,lateral aclexplode(p.proacl) a
 where p.oid='terra_private.activate_machine_publication(uuid,uuid,uuid,text,uuid,text)'::regprocedure
 and a.grantee=0 and a.privilege_type='EXECUTE'),'PUBLIC execute is revoked');
select ok(tgdeferrable and tginitdeferred and tgenabled='O','Commit guard is enabled and initially deferred')
 from pg_trigger where tgrelid='terra_private.machine_publication_activations'::regclass
 and tgname='machine_publication_activation_commit_guard';
select is(response->>'status','activated','One selected condition can activate fictionally') from checked_activation;
select is(response->>'visibilityState','pending','Activation does not claim public visibility') from checked_activation;
select is((select run_state from terra_private.update_runs limit 1),'running','One issue does not finish entire run');
select is((select commit_state from terra_private.update_runs limit 1),'partial','Group commit remains partial until run finalization');
select is((select count(*) from terra_private.machine_publication_activations),1::bigint,'One durable-style receipt is inserted');
select is((select count(*) from terra_private.issue_publication_machine_bindings),1::bigint,'One exact selected decision is bound');
select is((select count(*) from terra_private.issue_heads where current_publication_id is not null),1::bigint,'One head advances');
select throws_ok($$update terra_private.machine_publication_activations set request_fingerprint=repeat('a',64)$$,
 '23514','Automatic decision records are append-only','Activation receipt cannot be rewritten');
select throws_ok($$delete from terra_private.machine_publication_activations$$,
 '23514','Automatic decision records are append-only','Activation receipt cannot be removed');
select throws_ok($$update terra_private.issue_publications set snapshot=jsonb_set(snapshot,'{summary}','"Fictional replacement"')$$,
 '23514','Activated publication is immutable','Activated bytes require a new publication, not a rewrite');
set local time zone 'Europe/Oslo';
select is(terra_private.machine_publication_hash(p),expected.publication_sha256,
 'Publication fingerprint is independent of session time zone')
 from terra_private.issue_publications p,expected_activation_identity expected;
set local time zone 'UTC';
set constraints terra_private.machine_publication_activation_commit_guard immediate;
select pass('Final activation authority/time guard runs before rollback');
select * from finish();
rollback;
