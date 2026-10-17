-- Extension for a NEW owned PDF laboratory only; not a migration or capture.
-- Reuse the existing result row and portable four-part frame. Full originals
-- and independent context are checked by the trusted Python producer/reviewer.
create table tf_pdf_result_rehearsal.preparations (
 operation_id uuid primary key,
 artifact_id uuid not null unique default gen_random_uuid(),
 result_operation_id uuid not null references tf_pdf_result_rehearsal.results(operation_id),
 intent bytea not null check(octet_length(intent) between 1 and 4096),
 packet bytea not null check(octet_length(packet) between 1 and 65536),
 stored_at timestamptz not null check(isfinite(stored_at))
);
create index pdf_preparation_result_idx on tf_pdf_result_rehearsal.preparations(result_operation_id);
alter table tf_pdf_result_rehearsal.preparations enable row level security;
revoke all on tf_pdf_result_rehearsal.preparations from public;

create function tf_pdf_result_rehearsal.refuse_preparation_mutation()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin raise exception using errcode='55000',message='invented_pdf_preparation_append_only'; end
$$;
revoke all on function tf_pdf_result_rehearsal.refuse_preparation_mutation() from public;
create trigger pdf_preparation_append_only before update or delete on tf_pdf_result_rehearsal.preparations
 for each row execute function tf_pdf_result_rehearsal.refuse_preparation_mutation();
create trigger pdf_preparation_no_truncate before truncate on tf_pdf_result_rehearsal.preparations
 for each statement execute function tf_pdf_result_rehearsal.refuse_preparation_mutation();

create function tf_pdf_result_rehearsal.preparation_receipt(p_operation uuid)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog as $$
declare r tf_pdf_result_rehearsal.preparations%rowtype;
begin
 if current_user<>'postgres' or session_user<>'postgres' then
  raise exception using errcode='42501',message='invented_pdf_preparation_owner_required'; end if;
 select * into r from tf_pdf_result_rehearsal.preparations where operation_id=p_operation;
 if not found then raise exception using errcode='22023',message='invented_pdf_preparation_unavailable'; end if;
 return jsonb_build_object('schema_version',1,'kind','invented_pdf_preparation_stored',
  'operation_id',r.operation_id,'artifact_id',r.artifact_id,'result_operation_id',r.result_operation_id,
  'stored_at',to_char(r.stored_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'intent_base64',replace(encode(r.intent,'base64'),E'\n',''),
  'packet_base64',replace(encode(r.packet,'base64'),E'\n',''),
  'intent_sha256',encode(sha256(r.intent),'hex'),'packet_sha256',encode(sha256(r.packet),'hex'),
  'intent_bytes',octet_length(r.intent),'packet_bytes',octet_length(r.packet));
end
$$;
revoke all on function tf_pdf_result_rehearsal.preparation_receipt(uuid) from public;

create function tf_pdf_result_rehearsal.store_preparation(p_intent bytea,p_packet bytea)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare j json;f json;i jsonb;frame jsonb;proof jsonb;parts bytea[]:=array[]::bytea[];
 keys text[];name text;field_name text;raw_part bytea;part_limit integer;slot integer:=0;
 operation uuid;result_operation uuid;prepared timestamptz;at timestamptz;
 source tf_pdf_result_rehearsal.results%rowtype;old tf_pdf_result_rehearsal.preparations%rowtype;
 source_intent jsonb;receipt jsonb;
begin
 if current_user<>'postgres' or session_user<>'postgres' then
  raise exception using errcode='42501',message='invented_pdf_preparation_owner_required'; end if;
 if current_setting('transaction_isolation')<>'read committed' or current_setting('transaction_read_only')<>'off' then
  raise exception using errcode='25001',message='invented_pdf_preparation_transaction_required'; end if;
 if p_intent is null or p_packet is null or octet_length(p_intent) not between 1 and 4096
  or octet_length(p_packet) not between 1 and 65536 then
  raise exception using errcode='22023',message='invented_pdf_preparation_input_invalid'; end if;
 begin
  j:=convert_from(p_intent,'UTF8')::json;f:=convert_from(p_packet,'UTF8')::json;i:=j::jsonb;frame:=f::jsonb;
 exception when others then raise exception using errcode='22023',message='invented_pdf_preparation_input_invalid'; end;
 if json_typeof(j) is distinct from 'object' or json_typeof(f) is distinct from 'object' then
  raise exception using errcode='22023',message='invented_pdf_preparation_input_invalid'; end if;
 select array_agg(key order by key) into keys from json_object_keys(j) key;
 if keys is distinct from array['context_raw_sha256','extraction_artifact_id','extraction_operation_id','extraction_output_sha256',
  'extraction_request_sha256','kind','operation_id','payload_sha256','prepared_at','provenance_sha256','schema_version','selection_sha256']
  or json_typeof(j->'schema_version') is distinct from 'number' or j->>'schema_version'<>'1'
  or j->>'kind' is distinct from 'invented_detached_pdf_proposal_preparation' then
  raise exception using errcode='22023',message='invented_pdf_preparation_intent_invalid'; end if;
 foreach name in array array['operation_id','extraction_operation_id','extraction_artifact_id'] loop
  if json_typeof(j->name) is distinct from 'string' or j->>name!~'^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then
   raise exception using errcode='22023',message='invented_pdf_preparation_intent_invalid'; end if;
 end loop;
 foreach name in array array['payload_sha256','selection_sha256','provenance_sha256','context_raw_sha256','extraction_request_sha256','extraction_output_sha256'] loop
  if json_typeof(j->name) is distinct from 'string' or j->>name!~'^[a-f0-9]{64}$' then
   raise exception using errcode='22023',message='invented_pdf_preparation_intent_invalid'; end if;
 end loop;
 if json_typeof(j->'prepared_at') is distinct from 'string'
  or j->>'prepared_at'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{6}Z$' then
  raise exception using errcode='22023',message='invented_pdf_preparation_time_invalid'; end if;
 begin
  operation:=(j->>'operation_id')::uuid;result_operation:=(j->>'extraction_operation_id')::uuid;
  prepared:=(j->>'prepared_at')::timestamptz;
 exception when others then raise exception using errcode='22023',message='invented_pdf_preparation_intent_invalid'; end;
 if not isfinite(prepared) or to_char(prepared at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')<>j->>'prepared_at'
  or prepared>clock_timestamp() then raise exception using errcode='22023',message='invented_pdf_preparation_time_invalid'; end if;
 select array_agg(key order by key) into keys from json_object_keys(f) key;
 if keys is distinct from array['context_base64','intent_base64','kind','payload_base64','provenance_base64','schema_version','selection_base64']
  or json_typeof(f->'schema_version') is distinct from 'number' or f->>'schema_version'<>'1'
  or f->>'kind' is distinct from 'invented_portable_pdf_preparation' then
  raise exception using errcode='22023',message='invented_pdf_preparation_packet_invalid'; end if;
 foreach field_name in array array['intent_base64','payload_base64','selection_base64','provenance_base64','context_base64'] loop
  slot:=slot+1;part_limit:=case slot when 1 then 4096 when 2 then 16384 when 3 then 2048 when 4 then 65536 else 32768 end;
  if json_typeof(f->field_name) is distinct from 'string' then
   raise exception using errcode='22023',message='invented_pdf_preparation_part_invalid'; end if;
  begin raw_part:=decode(f->>field_name,'base64');
  exception when others then raise exception using errcode='22023',message='invented_pdf_preparation_part_invalid'; end;
  if octet_length(raw_part) not between 1 and part_limit
   or replace(encode(raw_part,'base64'),E'\n','') is distinct from f->>field_name then
   raise exception using errcode='22023',message='invented_pdf_preparation_part_invalid'; end if;
  if slot=1 then
   if raw_part is distinct from p_intent then raise exception using errcode='22023',message='invented_pdf_preparation_intent_invalid'; end if;
  else
   name:=case slot when 2 then 'payload_sha256' when 3 then 'selection_sha256' when 4 then 'provenance_sha256' else 'context_raw_sha256' end;
   if encode(sha256(raw_part),'hex') is distinct from j->>name then raise exception using errcode='22023',message='invented_pdf_preparation_part_invalid'; end if;
   parts:=array_append(parts,raw_part);
  end if;
 end loop;
 begin proof:=convert_from(parts[3],'UTF8')::jsonb;
 exception when others then raise exception using errcode='22023',message='invented_pdf_preparation_crosslink_invalid'; end;
 select * into source from tf_pdf_result_rehearsal.results where operation_id=result_operation;
 if not found then raise exception using errcode='23503',message='invented_pdf_preparation_result_missing'; end if;
 source_intent:=convert_from(source.intent,'UTF8')::jsonb;
 if jsonb_typeof(proof) is distinct from 'object' or proof->>'kind' is distinct from 'detached_pdf_extraction_proposal'
  or proof->>'prepared_at' is distinct from j->>'prepared_at' or proof->>'artifact_observed_at' is distinct from j->>'prepared_at'
  or prepared<source.stored_at or proof->'artifact'->>'operation_id' is distinct from result_operation::text
  or proof->'artifact'->>'artifact_id' is distinct from source.artifact_id::text
  or j->>'extraction_artifact_id' is distinct from source.artifact_id::text
  or proof->'current'->>'packet_sha256' is distinct from source_intent->>'current_packet_sha256'
  or proof->>'artifact_stored_at' is distinct from to_char(source.stored_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  or proof->>'artifact_prepared_at' is distinct from source_intent->>'prepared_at'
  or j->>'extraction_request_sha256' is distinct from source_intent->>'request_sha256'
  or j->>'extraction_output_sha256' is distinct from source_intent->>'output_sha256'
  or proof->'artifact'->>'request_sha256' is distinct from j->>'extraction_request_sha256'
  or proof->'artifact'->>'output_sha256' is distinct from j->>'extraction_output_sha256'
  or proof->>'canonical_intent_sha256' is distinct from encode(sha256(source.intent),'hex')
  or proof->>'full_receipt_sha256' is distinct from encode(sha256(convert_to(tf_pdf_result_rehearsal.result_receipt(result_operation)::text,'UTF8')),'hex') then
  raise exception using errcode='22023',message='invented_pdf_preparation_crosslink_invalid'; end if;
 if (source_intent->'previous_packet_sha256'='null'::jsonb and proof->'previous' is distinct from 'null'::jsonb)
  or (source_intent->'previous_packet_sha256'<>'null'::jsonb and
      proof->'previous'->>'packet_sha256' is distinct from source_intent->>'previous_packet_sha256') then
  raise exception using errcode='22023',message='invented_pdf_preparation_crosslink_invalid'; end if;
 receipt:=jsonb_build_object('schema_version',1,'kind','invented_pdf_preparation_stored','operation_id',operation,
  'artifact_id','ffffffff-ffff-4fff-bfff-ffffffffffff','result_operation_id',result_operation,
  'stored_at','9999-12-31T23:59:59.999999Z','intent_base64',replace(encode(p_intent,'base64'),E'\n',''),
  'packet_base64',replace(encode(p_packet,'base64'),E'\n',''),'intent_sha256',encode(sha256(p_intent),'hex'),
  'packet_sha256',encode(sha256(p_packet),'hex'),'intent_bytes',octet_length(p_intent),'packet_bytes',octet_length(p_packet));
 if octet_length(receipt::text)+4096>131072 then raise exception using errcode='22023',message='invented_pdf_preparation_receipt_limit'; end if;
 perform pg_advisory_xact_lock(hashtextextended(operation::text,1));
 select * into old from tf_pdf_result_rehearsal.preparations where operation_id=operation;
 if found then
  if old.intent is distinct from p_intent or old.packet is distinct from p_packet then
   raise exception using errcode='23505',message='invented_pdf_preparation_replay_conflict'; end if;
  return tf_pdf_result_rehearsal.preparation_receipt(operation);
 end if;
 at:=clock_timestamp();if at<prepared then raise exception using errcode='22023',message='invented_pdf_preparation_time_invalid'; end if;
 insert into tf_pdf_result_rehearsal.preparations(operation_id,result_operation_id,intent,packet,stored_at)
  values(operation,result_operation,p_intent,p_packet,at);
 return tf_pdf_result_rehearsal.preparation_receipt(operation);
end
$$;
revoke all on function tf_pdf_result_rehearsal.store_preparation(bytea,bytea) from public;
