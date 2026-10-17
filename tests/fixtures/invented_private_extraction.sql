-- New owned network-none laboratory only. No operational migration or grant.
-- The trusted offline compiler/parser owns semantic request/proposal checks.
-- Native checks below prove byte custody and existing-document associations,
-- never provider execution, actual cost, factual support or publication.
create schema tf_private_extraction authorization tf_feed_lab_owner;
revoke all on schema tf_private_extraction from public;
set local role tf_feed_lab_owner;
create table tf_private_extraction.results (
 operation_id uuid primary key,
 artifact_id uuid not null unique default gen_random_uuid(),
 current_document_operation_id uuid not null references tf_feed_rehearsal.document_results(operation_id),
 previous_document_operation_id uuid not null references tf_feed_rehearsal.document_results(operation_id),
 input jsonb not null check(jsonb_typeof(input)='object'),
 request_raw bytea not null check(octet_length(request_raw) between 1 and 131072),
 output_raw bytea not null check(octet_length(output_raw) between 1 and 8192),
 stored_at timestamptz not null check(isfinite(stored_at)),
 check(current_document_operation_id<>previous_document_operation_id),
 check(encode(sha256(request_raw),'hex')=input->>'request_sha256'),
 check(encode(sha256(output_raw),'hex')=input->>'output_sha256'),
 check(input->'proposal'->>'review_state'='unverified')
);
alter table tf_private_extraction.results enable row level security;
revoke all on tf_private_extraction.results from public;

create function tf_private_extraction.refuse_mutation()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin raise exception using errcode='55000',message='invented_private_extraction_append_only'; end
$$;
revoke all on function tf_private_extraction.refuse_mutation() from public;
create trigger private_extraction_append_only before update or delete on tf_private_extraction.results
for each row execute function tf_private_extraction.refuse_mutation();

create function tf_private_extraction.result_receipt(p_operation uuid)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog as $$
declare r tf_private_extraction.results%rowtype;v jsonb;
begin
 if current_user<>'tf_feed_lab_owner' then
  raise exception using errcode='42501',message='invented_private_extraction_owner_required'; end if;
 select * into r from tf_private_extraction.results where operation_id=p_operation;
 if not found then raise exception using errcode='22023',message='invented_private_extraction_unavailable'; end if;
 v:=jsonb_build_object('schema_version',1,'kind','invented_private_extraction_stored',
  'operation_id',r.operation_id,'artifact_id',r.artifact_id,
  'stored_at',to_char(r.stored_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'input',r.input,'request_base64',replace(encode(r.request_raw,'base64'),E'\n',''),
  'output_base64',replace(encode(r.output_raw,'base64'),E'\n',''));
 if octet_length(v::text)+29>131072 then
  raise exception using errcode='22023',message='invented_private_extraction_readback_limit'; end if;
 return v;
end
$$;
revoke all on function tf_private_extraction.result_receipt(uuid) from public;

create function tf_private_extraction.store_result(p jsonb,p_request bytea,p_output bytea)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare keys text[];field_name text;d jsonb;doc tf_feed_rehearsal.document_results%rowtype;
 old tf_private_extraction.results%rowtype;current_doc tf_feed_rehearsal.document_results%rowtype;request_json jsonb;output_json jsonb;output_text json;
 operation uuid;current_operation uuid;previous_operation uuid;prepared timestamptz;at timestamptz;receipt jsonb;
begin
 if current_user<>'tf_feed_lab_owner' then
  raise exception using errcode='42501',message='invented_private_extraction_owner_required'; end if;
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>16384
  or octet_length(p_request) not between 1 and 131072 or p_request is null
  or octet_length(p_output) not between 1 and 8192 or p_output is null then
  raise exception using errcode='22023',message='invented_private_extraction_input_invalid'; end if;
 select array_agg(key order by key) into keys from jsonb_object_keys(p) key;
 if keys is distinct from array['current_document','kind','maximum_output_tokens','operation_id','output_sha256',
  'prepared_at','previous_document','proposal','request_sha256','schema_version','selected_payload_sha256']
  or p->'schema_version' is distinct from '1'::jsonb
  or p->>'kind' is distinct from 'invented_private_extraction_result'
  or jsonb_typeof(p->'proposal') is distinct from 'object'
  or jsonb_typeof(p->'maximum_output_tokens') is distinct from 'number'
  or p->>'maximum_output_tokens' !~ '^[1-9][0-9]{0,6}$'
  or (p->>'maximum_output_tokens')::integer>1000000 then
  raise exception using errcode='22023',message='invented_private_extraction_input_invalid'; end if;
 foreach field_name in array array['operation_id','output_sha256','prepared_at','request_sha256','selected_payload_sha256'] loop
  if jsonb_typeof(p->field_name) is distinct from 'string' then
   raise exception using errcode='22023',message='invented_private_extraction_field_invalid'; end if;
 end loop;
 if p->>'operation_id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  or p->>'prepared_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{6}Z$'
  or p->>'request_sha256' is distinct from encode(sha256(p_request),'hex')
  or p->>'output_sha256' is distinct from encode(sha256(p_output),'hex')
  or p->>'selected_payload_sha256' !~ '^[a-f0-9]{64}$' then
  raise exception using errcode='22023',message='invented_private_extraction_bytes_invalid'; end if;
 operation:=(p->>'operation_id')::uuid;prepared:=(p->>'prepared_at')::timestamptz;
 if not isfinite(prepared) or prepared>clock_timestamp() then
  raise exception using errcode='22023',message='invented_private_extraction_time_invalid'; end if;
 begin
  request_json:=convert_from(p_request,'UTF8')::jsonb;
  output_text:=convert_from(p_output,'UTF8')::json;output_json:=output_text::jsonb;
 exception when invalid_text_representation or character_not_in_repertoire or untranslatable_character then
  raise exception using errcode='22023',message='invented_private_extraction_json_invalid';
 end;
 select array_agg(key order by key) into keys from json_object_keys(output_text) key;
 if keys is distinct from array['language_code','locator','proposed_assertion','proposed_claim_type','schema_version',
   'source_date_text','source_sha256','source_version_id']
  or output_json->'schema_version' is distinct from '1'::jsonb
  or p->'proposal' is distinct from (output_json-'schema_version')||jsonb_build_object('review_state','unverified')
  or request_json->>'kind' is distinct from 'private_offline_extraction_request'
  or request_json->>'template_id' is distinct from 'tf-private-passage-extraction-1'
  or request_json->'maximum_output_tokens' is distinct from p->'maximum_output_tokens'
  or request_json->'maximum_output_bytes' is distinct from '8192'::jsonb
  or request_json->'selected_payload_sha256' is distinct from p->'selected_payload_sha256' then
  raise exception using errcode='22023',message='invented_private_extraction_request_output_invalid'; end if;
 foreach field_name in array array['current_document','previous_document'] loop
  d:=p->field_name;
  if jsonb_typeof(d) is distinct from 'object' then
   raise exception using errcode='22023',message='invented_private_extraction_document_invalid'; end if;
  select array_agg(key order by key) into keys from jsonb_object_keys(d) key;
  if keys is distinct from array['artifact_id','content_sha256','operation_id','source_version_id']
   or exists(select 1 from jsonb_each(d) e where jsonb_typeof(e.value)<>'string')
   or d->>'operation_id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then
   raise exception using errcode='22023',message='invented_private_extraction_document_invalid'; end if;
  select * into doc from tf_feed_rehearsal.document_results where operation_id=(d->>'operation_id')::uuid;
  if not found or doc.artifact_id::text is distinct from d->>'artifact_id'
   or doc.document_source_version_id::text is distinct from d->>'source_version_id'
   or doc.document_sha256 is distinct from d->>'content_sha256' or doc.stored_at>prepared then
   raise exception using errcode='22023',message='invented_private_extraction_document_mismatch'; end if;
  if field_name='current_document' then
   current_operation:=doc.operation_id;current_doc:=doc;
   if request_json->'selected_payload'->>'source_version_id' is distinct from doc.document_source_version_id::text
    or request_json->'selected_payload'->>'content_sha256' is distinct from doc.document_sha256
    or output_json->>'source_version_id' is distinct from doc.document_source_version_id::text
    or output_json->>'source_sha256' is distinct from doc.document_sha256
    or request_json->'selected_payload'->>'source_key' is distinct from doc.document_source_key
    or request_json->'selected_payload'->>'item_key' is distinct from doc.document_item_key
    or request_json->'selected_payload'->>'mapping_sha256' is distinct from doc.input->'mapping'->>'mapping_sha256'
    or request_json->'selected_payload'->>'language_code' is distinct from doc.input->'mapping'->>'language_code'
    or output_json->>'language_code' is distinct from doc.input->'mapping'->>'language_code' then
    raise exception using errcode='22023',message='invented_private_extraction_source_mismatch'; end if;
  else
   previous_operation:=doc.operation_id;
   if doc.document_source_key is distinct from current_doc.document_source_key
    or doc.document_item_key is distinct from current_doc.document_item_key
    or doc.input->'document'->>'source_url' is distinct from current_doc.input->'document'->>'source_url'
    or doc.document_source_version_id=current_doc.document_source_version_id
    or doc.input->'mapping'->>'mapping_sha256' is distinct from current_doc.input->'mapping'->>'mapping_sha256'
    or doc.input->'mapping'->>'language_code' is distinct from current_doc.input->'mapping'->>'language_code'
    or (doc.input->'document'->>'retrieved_at')::timestamptz>(current_doc.input->'document'->>'retrieved_at')::timestamptz then
    raise exception using errcode='22023',message='invented_private_extraction_pair_mismatch'; end if;
  end if;
 end loop;
 if current_operation=previous_operation then
  raise exception using errcode='22023',message='invented_private_extraction_document_mismatch'; end if;
 -- One fixed table lock serializes exact replay/conflict and the laboratory
 -- maximum of50 artifacts. This is not an operational usage/budget policy.
 lock table tf_private_extraction.results in share row exclusive mode;
 select * into old from tf_private_extraction.results where operation_id=operation;
 if found then
  if old.input is distinct from p or old.request_raw is distinct from p_request or old.output_raw is distinct from p_output then
   raise exception using errcode='22023',message='invented_private_extraction_operation_conflict'; end if;
  return tf_private_extraction.result_receipt(operation);
 end if;
 if (select count(*) from tf_private_extraction.results)>=50 then
  raise exception using errcode='22023',message='invented_private_extraction_lab_quota'; end if;
 at:=clock_timestamp();
 insert into tf_private_extraction.results(operation_id,current_document_operation_id,previous_document_operation_id,input,request_raw,output_raw,stored_at)
 values(operation,current_operation,previous_operation,p,p_request,p_output,at);
 -- Full output fit is checked before transaction commit, even for direct
 -- invented owner calls that bypass the conservative Python preflight.
 receipt:=tf_private_extraction.result_receipt(operation);
 return receipt;
end
$$;
revoke all on function tf_private_extraction.store_result(jsonb,bytea,bytea) from public;
reset role;
