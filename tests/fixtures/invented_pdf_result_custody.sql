-- Uninstalled fictional owner-only PDF result BYTE custody, not qualification.
-- The complete independent PdfResultPacketExpected remains outside this table.
create schema tf_pdf_result_rehearsal authorization postgres;
revoke all on schema tf_pdf_result_rehearsal from public;
create table tf_pdf_result_rehearsal.results (
 operation_id uuid primary key,
 artifact_id uuid not null unique default gen_random_uuid(),
 intent bytea not null check(octet_length(intent) between 1 and 2048),
 packet bytea not null check(octet_length(packet) between 1 and 65536),
 stored_at timestamptz not null check(isfinite(stored_at))
);
alter table tf_pdf_result_rehearsal.results enable row level security;
revoke all on tf_pdf_result_rehearsal.results from public;

create function tf_pdf_result_rehearsal.refuse_mutation()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin raise exception using errcode='55000',message='invented_pdf_result_append_only'; end
$$;
revoke all on function tf_pdf_result_rehearsal.refuse_mutation() from public;
create trigger pdf_result_append_only before update or delete on tf_pdf_result_rehearsal.results
 for each row execute function tf_pdf_result_rehearsal.refuse_mutation();
create trigger pdf_result_no_truncate before truncate on tf_pdf_result_rehearsal.results
 for each statement execute function tf_pdf_result_rehearsal.refuse_mutation();

create function tf_pdf_result_rehearsal.result_receipt(p_operation uuid)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog as $$
declare r tf_pdf_result_rehearsal.results%rowtype;
begin
 if current_user<>'postgres' or session_user<>'postgres' then
  raise exception using errcode='42501',message='invented_pdf_result_owner_required'; end if;
 select * into r from tf_pdf_result_rehearsal.results where operation_id=p_operation;
 if not found then raise exception using errcode='22023',message='invented_pdf_result_unavailable'; end if;
 return jsonb_build_object('schema_version',1,'kind','invented_pdf_result_stored',
  'operation_id',r.operation_id,'artifact_id',r.artifact_id,
  'stored_at',to_char(r.stored_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'intent_base64',replace(encode(r.intent,'base64'),E'\n',''),
  'packet_base64',replace(encode(r.packet,'base64'),E'\n',''),
  'intent_sha256',encode(sha256(r.intent),'hex'),'packet_sha256',encode(sha256(r.packet),'hex'),
  'intent_bytes',octet_length(r.intent),'packet_bytes',octet_length(r.packet));
end
$$;
revoke all on function tf_pdf_result_rehearsal.result_receipt(uuid) from public;

create function tf_pdf_result_rehearsal.store_result(p_intent bytea,p_packet bytea)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare j json;p json;i jsonb;b jsonb;part json;keys text[];name text;field_name text;
 raw_part bytea;part_limit integer;operation uuid;prepared timestamptz;at timestamptz;
 old tf_pdf_result_rehearsal.results%rowtype;receipt jsonb;
begin
 if current_user<>'postgres' or session_user<>'postgres' then
  raise exception using errcode='42501',message='invented_pdf_result_owner_required'; end if;
 if current_setting('transaction_isolation')<>'read committed' or current_setting('transaction_read_only')<>'off' then
  raise exception using errcode='25001',message='invented_pdf_result_transaction_required'; end if;
 if p_intent is null or p_packet is null or octet_length(p_intent) not between 1 and 2048
  or octet_length(p_packet) not between 1 and 65536 then
  raise exception using errcode='22023',message='invented_pdf_result_input_invalid'; end if;
 begin
  j:=convert_from(p_intent,'UTF8')::json;p:=convert_from(p_packet,'UTF8')::json;i:=j::jsonb;b:=p::jsonb;
 exception when others then
  raise exception using errcode='22023',message='invented_pdf_result_input_invalid'; end;
 if json_typeof(j) is distinct from 'object' or json_typeof(p) is distinct from 'object' then
  raise exception using errcode='22023',message='invented_pdf_result_input_invalid'; end if;
 select array_agg(key order by key) into keys from json_object_keys(j) key;
 if keys is distinct from array['current_packet_sha256','kind','operation_id','output_sha256','packet_bytes',
  'packet_sha256','prepared_at','previous_packet_sha256','request_sha256','schema_version','selected_payload_sha256']
  or json_typeof(j->'schema_version') is distinct from 'number' or j->>'schema_version'<>'1'
  or j->>'kind' is distinct from 'invented_pdf_result_custody'
  or json_typeof(j->'packet_bytes') is distinct from 'number' or j->>'packet_bytes'!~'^[1-9][0-9]{0,4}$'
  or j->>'packet_bytes' is distinct from octet_length(p_packet)::text then
  raise exception using errcode='22023',message='invented_pdf_result_intent_invalid'; end if;
 foreach name in array array['operation_id','prepared_at','kind'] loop
  if json_typeof(j->name) is distinct from 'string' then
   raise exception using errcode='22023',message='invented_pdf_result_intent_invalid'; end if;
 end loop;
 foreach name in array array['current_packet_sha256','output_sha256','packet_sha256','request_sha256','selected_payload_sha256'] loop
  if json_typeof(j->name) is distinct from 'string' or j->>name!~'^[a-f0-9]{64}$' then
   raise exception using errcode='22023',message='invented_pdf_result_intent_invalid'; end if;
 end loop;
 if (json_typeof(j->'previous_packet_sha256') is distinct from 'null' and
    (json_typeof(j->'previous_packet_sha256') is distinct from 'string' or j->>'previous_packet_sha256'!~'^[a-f0-9]{64}$'))
  or j->>'operation_id'!~'^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  or j->>'prepared_at'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{6}Z$'
  or j->>'packet_sha256' is distinct from encode(sha256(p_packet),'hex') then
  raise exception using errcode='22023',message='invented_pdf_result_intent_invalid'; end if;
 begin
  operation:=(j->>'operation_id')::uuid;prepared:=(j->>'prepared_at')::timestamptz;
 exception when others then
  raise exception using errcode='22023',message='invented_pdf_result_intent_invalid'; end;
 if not isfinite(prepared) or to_char(prepared at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')<>j->>'prepared_at'
  or prepared>clock_timestamp() then
  raise exception using errcode='22023',message='invented_pdf_result_time_invalid'; end if;
 select array_agg(key order by key) into keys from json_object_keys(p) key;
 if keys is distinct from array['current','kind','operation_id','output','prepared_at','previous','request','schema_version']
  or json_typeof(p->'schema_version') is distinct from 'number' or p->>'schema_version'<>'1'
  or p->>'kind' is distinct from 'private_supplied_pdf_result_packet'
  or json_typeof(p->'kind') is distinct from 'string' or json_typeof(p->'operation_id') is distinct from 'string'
  or json_typeof(p->'prepared_at') is distinct from 'string'
  or p->>'operation_id' is distinct from j->>'operation_id' or p->>'prepared_at' is distinct from j->>'prepared_at'
  or json_typeof(p->'request') is distinct from 'object' then
  raise exception using errcode='22023',message='invented_pdf_result_packet_invalid'; end if;
 select array_agg(key order by key) into keys from json_object_keys(p->'request') key;
 if keys is distinct from array['body','evidence_state','item_key','maximum_output_tokens','request_sha256','selected_payload_sha256']
  or json_typeof(p->'request'->'item_key') is distinct from 'string'
  or json_typeof(p->'request'->'evidence_state') is distinct from 'string'
  or p->'request'->>'evidence_state' is distinct from 'offline_pdf_complete_extraction_envelope_only'
  or json_typeof(p->'request'->'maximum_output_tokens') is distinct from 'number'
  or p->'request'->>'maximum_output_tokens'!~'^[1-9][0-9]{0,6}$'
  or length(p->'request'->>'maximum_output_tokens')>7 then
  raise exception using errcode='22023',message='invented_pdf_result_request_invalid'; end if;
 if (p->'request'->>'maximum_output_tokens')::integer>1000000
  or json_typeof(p->'request'->'request_sha256') is distinct from 'string'
  or json_typeof(p->'request'->'selected_payload_sha256') is distinct from 'string'
  or p->'request'->>'request_sha256' is distinct from j->>'request_sha256'
  or p->'request'->>'selected_payload_sha256' is distinct from j->>'selected_payload_sha256' then
  raise exception using errcode='22023',message='invented_pdf_result_request_invalid'; end if;
 foreach field_name in array array['current','previous','request','output'] loop
  if field_name='previous' and json_typeof(p->field_name)='null' then
   if json_typeof(j->'previous_packet_sha256') is distinct from 'null' then
    raise exception using errcode='22023',message='invented_pdf_result_previous_invalid'; end if;
   continue;
  end if;
  part:=case when field_name='request' then p->'request'->'body' else p->field_name end;
  part_limit:=case when field_name='output' then 8192 when field_name='request' then 131072 else 65536 end;
  if json_typeof(part) is distinct from 'object' then
   raise exception using errcode='22023',message='invented_pdf_result_part_invalid'; end if;
  select array_agg(key order by key) into keys from json_object_keys(part) key;
  if keys is distinct from array['base64','bytes','sha256'] or json_typeof(part->'base64') is distinct from 'string'
   or json_typeof(part->'bytes') is distinct from 'number' or part->>'bytes'!~'^[1-9][0-9]{0,5}$'
   or json_typeof(part->'sha256') is distinct from 'string' or part->>'sha256'!~'^[a-f0-9]{64}$' then
   raise exception using errcode='22023',message='invented_pdf_result_part_invalid'; end if;
  begin raw_part:=decode(part->>'base64','base64');
  exception when others then
   raise exception using errcode='22023',message='invented_pdf_result_part_invalid'; end;
  if octet_length(raw_part) not between 1 and part_limit or part->>'bytes'<>octet_length(raw_part)::text
   or replace(encode(raw_part,'base64'),E'\n','') is distinct from part->>'base64'
   or encode(sha256(raw_part),'hex') is distinct from part->>'sha256'
   or part->>'sha256' is distinct from j->>(case field_name when 'current' then 'current_packet_sha256'
    when 'previous' then 'previous_packet_sha256' when 'request' then 'request_sha256' else 'output_sha256' end) then
   raise exception using errcode='22023',message='invented_pdf_result_part_invalid'; end if;
 end loop;
 -- Conservative complete receipt budget BEFORE any row write. Metadata is
 -- bounded ASCII; neither raw intent nor packet is decoded into the receipt.
 receipt:=jsonb_build_object('schema_version',1,'kind','invented_pdf_result_stored','operation_id',operation,
  'artifact_id','ffffffff-ffff-4fff-bfff-ffffffffffff','stored_at','9999-12-31T23:59:59.999999Z',
  'intent_base64',replace(encode(p_intent,'base64'),E'\n',''),'packet_base64',replace(encode(p_packet,'base64'),E'\n',''),
  'intent_sha256',encode(sha256(p_intent),'hex'),'packet_sha256',encode(sha256(p_packet),'hex'),
  'intent_bytes',octet_length(p_intent),'packet_bytes',octet_length(p_packet));
 if octet_length(receipt::text)+4096>131072 then
  raise exception using errcode='22023',message='invented_pdf_result_receipt_limit'; end if;
 perform pg_advisory_xact_lock(hashtextextended(operation::text,0));
 select * into old from tf_pdf_result_rehearsal.results where operation_id=operation;
 if found then
  if old.intent is distinct from p_intent or old.packet is distinct from p_packet then
   raise exception using errcode='23505',message='invented_pdf_result_replay_conflict'; end if;
  return tf_pdf_result_rehearsal.result_receipt(operation);
 end if;
 at:=clock_timestamp();
 if at<prepared then raise exception using errcode='22023',message='invented_pdf_result_time_invalid'; end if;
 insert into tf_pdf_result_rehearsal.results(operation_id,intent,packet,stored_at)
  values(operation,p_intent,p_packet,at);
 return tf_pdf_result_rehearsal.result_receipt(operation);
end
$$;
revoke all on function tf_pdf_result_rehearsal.store_result(bytea,bytea) from public;
