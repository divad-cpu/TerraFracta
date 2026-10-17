-- Privilege-semantics laboratory, ONLY in a newly created invented cluster.
-- Not a migration, login configuration, public API or source qualification.
-- Roles have no LOGIN/password and are never installed in the primary DB.
create role tf_feed_lab_owner nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
create role tf_feed_lab_writer nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
create role tf_feed_lab_observer nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;

alter schema tf_feed_rehearsal owner to tf_feed_lab_owner;
alter table tf_feed_rehearsal.streams owner to tf_feed_lab_owner;
alter table tf_feed_rehearsal.pages owner to tf_feed_lab_owner;
alter table tf_feed_rehearsal.items owner to tf_feed_lab_owner;
alter table tf_feed_rehearsal.outcomes owner to tf_feed_lab_owner;
alter table tf_feed_rehearsal.document_results owner to tf_feed_lab_owner;
alter function tf_feed_rehearsal.page_receipt(uuid,bytea) owner to tf_feed_lab_owner;
alter function tf_feed_rehearsal.capture(jsonb) owner to tf_feed_lab_owner;
alter function tf_feed_rehearsal.record_outcome(uuid,uuid,integer,text) owner to tf_feed_lab_owner;
alter function tf_feed_rehearsal.document_result_receipt(uuid,bytea,bytea) owner to tf_feed_lab_owner;
alter function tf_feed_rehearsal.complete_document_result(jsonb,bytea) owner to tf_feed_lab_owner;
-- Keep helpers INVOKER: only the small outer API crosses the privilege boundary.
alter function tf_feed_rehearsal.page_receipt(uuid,bytea) set search_path=pg_catalog,pg_temp;
alter function tf_feed_rehearsal.capture(jsonb) set search_path=pg_catalog,pg_temp;
alter function tf_feed_rehearsal.record_outcome(uuid,uuid,integer,text) set search_path=pg_catalog,pg_temp;
alter function tf_feed_rehearsal.document_result_receipt(uuid,bytea,bytea) set search_path=pg_catalog,pg_temp;
alter function tf_feed_rehearsal.complete_document_result(jsonb,bytea) set search_path=pg_catalog,pg_temp;
revoke all on schema tf_feed_rehearsal from public,tf_feed_lab_writer,tf_feed_lab_observer;
revoke all on all tables in schema tf_feed_rehearsal from public,tf_feed_lab_writer,tf_feed_lab_observer;
revoke all on all functions in schema tf_feed_rehearsal from public,tf_feed_lab_writer,tf_feed_lab_observer;

create schema tf_feed_runtime authorization tf_feed_lab_owner;
revoke all on schema tf_feed_runtime from public;
set local role tf_feed_lab_owner;
-- New functions of this newly created owner must not regain default PUBLIC EXECUTE.
alter default privileges revoke execute on functions from public;
-- Owner/installer explicitly assigns invented streams. This is a laboratory
-- scope, not an accepted source/rights/principal record or a multi-tenant ACL.
create table tf_feed_runtime.allowed_streams (
 stream_id uuid primary key references tf_feed_rehearsal.streams(id)
);
revoke all on tf_feed_runtime.allowed_streams from public,tf_feed_lab_writer,tf_feed_lab_observer;
alter table tf_feed_runtime.allowed_streams enable row level security;

create function tf_feed_runtime.require_stream(p_stream uuid)
returns void language plpgsql stable security invoker set search_path=pg_catalog,pg_temp as $$
begin
 if p_stream is null or not exists(select 1 from tf_feed_runtime.allowed_streams where stream_id=p_stream) then
  raise exception using errcode='42501',message='invented_runtime_scope_denied'; end if;
end
$$;

create function tf_feed_runtime.capture(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform tf_feed_runtime.require_stream((p->>'stream_id')::uuid);
 return tf_feed_rehearsal.capture(p);
end
$$;

create function tf_feed_runtime.complete_document_result(p jsonb,p_feed_raw bytea)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform tf_feed_runtime.require_stream((p->>'feed_stream_id')::uuid);
 return tf_feed_rehearsal.complete_document_result(p,p_feed_raw);
end
$$;

create function tf_feed_runtime.page_receipt(p_operation uuid,p_expected_raw bytea)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare scope uuid;
begin
 select stream_id into scope from tf_feed_rehearsal.pages where operation_id=p_operation;
 perform tf_feed_runtime.require_stream(scope);
 return tf_feed_rehearsal.page_receipt(p_operation,p_expected_raw);
end
$$;

create function tf_feed_runtime.document_result_receipt(p_operation uuid,p_document_raw bytea,p_feed_raw bytea)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare scope uuid;
begin
 select feed_stream_id into scope from tf_feed_rehearsal.document_results where operation_id=p_operation;
 perform tf_feed_runtime.require_stream(scope);
 return tf_feed_rehearsal.document_result_receipt(p_operation,p_document_raw,p_feed_raw);
end
$$;
-- Owner remains a table owner and bypasses its RLS intentionally. Writers and
-- observers are nonowners with no table access/policies or membership in owner.
revoke all on all functions in schema tf_feed_runtime from public,tf_feed_lab_writer,tf_feed_lab_observer;
grant usage on schema tf_feed_runtime to tf_feed_lab_writer,tf_feed_lab_observer;
grant execute on function tf_feed_runtime.capture(jsonb),tf_feed_runtime.complete_document_result(jsonb,bytea) to tf_feed_lab_writer;
grant execute on function tf_feed_runtime.page_receipt(uuid,bytea),tf_feed_runtime.document_result_receipt(uuid,bytea,bytea)
 to tf_feed_lab_writer,tf_feed_lab_observer;
reset role;
