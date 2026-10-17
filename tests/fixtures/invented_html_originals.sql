-- New owned network-none laboratory only. Never a primary migration.
-- Exact byte custody; SQL does not parse HTML or attest semantic/canonical truth.
do $$begin if current_user<>'postgres' or session_user<>'postgres' then raise exception using errcode='42501',message='invented_html_owner_required';end if;end$$;
create schema tf_html_rehearsal authorization postgres;
revoke all on schema tf_html_rehearsal from public;
create table tf_html_rehearsal.originals (
 operation_id uuid primary key,
 artifact_id uuid not null unique default gen_random_uuid(),
 raw bytea not null check(octet_length(raw) between 1 and 65536),
 metadata bytea not null check(octet_length(metadata) between 1 and 32768),
 stored_at timestamptz not null check(isfinite(stored_at))
);
alter table tf_html_rehearsal.originals enable row level security;
revoke all on tf_html_rehearsal.originals from public;

create function tf_html_rehearsal.refuse_mutation() returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin raise exception using errcode='55000',message='invented_html_append_only';end$$;
create trigger html_original_append_only before update or delete on tf_html_rehearsal.originals for each row execute function tf_html_rehearsal.refuse_mutation();

create function tf_html_rehearsal.original_receipt(p_operation uuid) returns jsonb language plpgsql stable security invoker set search_path=pg_catalog as $$
declare r tf_html_rehearsal.originals%rowtype;v jsonb;
begin
 if current_user<>'postgres' or session_user<>'postgres' then raise exception using errcode='42501',message='invented_html_owner_required';end if;
 select * into r from tf_html_rehearsal.originals where operation_id=p_operation;
 if not found then raise exception using errcode='22023',message='invented_html_original_unavailable';end if;
 v:=jsonb_build_object('schema_version',1,'kind','invented_html_original_stored','operation_id',r.operation_id,'artifact_id',r.artifact_id,
  'stored_at',to_char(r.stored_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'raw_base64',replace(encode(r.raw,'base64'),E'\n',''),'metadata_base64',replace(encode(r.metadata,'base64'),E'\n',''),
  'raw_sha256',encode(sha256(r.raw),'hex'),'metadata_sha256',encode(sha256(r.metadata),'hex'),
  'raw_bytes',octet_length(r.raw),'metadata_bytes',octet_length(r.metadata));
 if octet_length(v::text)+29>131072 then raise exception using errcode='22023',message='invented_html_receipt_limit';end if;
 return v;
end$$;

create function tf_html_rehearsal.store_original(p_metadata bytea,p_raw bytea) returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare j jsonb;j_original json;d jsonb;m jsonb;s jsonb;manifest jsonb;manifest_original json;span jsonb;passage jsonb;selection jsonb;
 keys text[];field_name text;operation uuid;prepared timestamptz;old tf_html_rehearsal.originals%rowtype;
 position integer;span_start integer;span_end integer;previous_end integer:=0;total integer:=0;locators text[]:=array[]::text[];ids text[]:=array[]::text[];
begin
 if current_user<>'postgres' or session_user<>'postgres' then raise exception using errcode='42501',message='invented_html_owner_required';end if;
 if current_setting('transaction_read_only')<>'off' or current_setting('transaction_isolation')<>'read committed' then raise exception using errcode='25000',message='invented_html_write_transaction_required';end if;
 if p_raw is null or p_metadata is null or octet_length(p_raw) not between 1 and 65536 or octet_length(p_metadata) not between 1 and 32768 then
  raise exception using errcode='22023',message='invented_html_input_invalid';end if;
 perform convert_from(p_raw,'UTF8');
 j_original:=convert_from(p_metadata,'UTF8')::json;j:=j_original::jsonb;
 if jsonb_typeof(j)<>'object' then raise exception using errcode='22023',message='invented_html_input_invalid';end if;
 select array_agg(key order by key) into keys from json_object_keys(j_original) key;
 if keys is distinct from array['adapter_identity','derivation_manifest_json','derivation_manifest_sha256','document','kind','mapping','operation_id','parser_identity','prepared_at','schema_version','snapshot']
  or j->'schema_version' is distinct from '1'::jsonb or j->>'kind' is distinct from 'invented_html_original_intent'
  or j->>'adapter_identity' is distinct from 'terrafracta-selected-html-parsed-text/v1'
  or j->>'parser_identity' is distinct from 'stdlib.html.parser.HTMLParser:convert_charrefs=False' then
  raise exception using errcode='22023',message='invented_html_input_invalid';end if;
 foreach field_name in array array['operation_id','prepared_at','derivation_manifest_json','derivation_manifest_sha256'] loop
  if jsonb_typeof(j->field_name) is distinct from 'string' then raise exception using errcode='22023',message='invented_html_input_invalid';end if;
 end loop;
 if j->>'operation_id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  or j->>'prepared_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{6}Z$' then
  raise exception using errcode='22023',message='invented_html_input_invalid';end if;
 operation:=(j->>'operation_id')::uuid;prepared:=(j->>'prepared_at')::timestamptz;
 d:=j->'document';m:=j->'mapping';s:=j->'snapshot';
 if jsonb_typeof(d) is distinct from 'object' or jsonb_typeof(m) is distinct from 'object' or jsonb_typeof(s) is distinct from 'object' then
  raise exception using errcode='22023',message='invented_html_shape_invalid';end if;
 select array_agg(key order by key) into keys from json_object_keys(j_original->'document') key;
 if keys is distinct from array['content_sha256','encoding','item_key','media_type','retrieved_at','source_key','source_url','source_version_id']
  or exists(select 1 from jsonb_each(d) e where jsonb_typeof(e.value)<>'string')
  or d->>'media_type' is distinct from 'text/html' or d->>'encoding' is distinct from 'utf-8'
  or d->>'source_key' !~ '^fictional-[a-z0-9:-]{1,109}$' or char_length(d->>'item_key') not between 1 and 120
  or d->>'source_version_id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  or d->>'source_url' !~ '^https://example[.]org/[^?#@[:space:]]+$'
  or d->>'content_sha256' is distinct from encode(sha256(p_raw),'hex')
  or d->>'retrieved_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{6}Z$' then
  raise exception using errcode='22023',message='invented_html_source_invalid';end if;
 if not isfinite(prepared) or not isfinite((d->>'retrieved_at')::timestamptz) or (d->>'retrieved_at')::timestamptz>prepared or prepared>clock_timestamp() then
  raise exception using errcode='22023',message='invented_html_chronology_invalid';end if;
 select array_agg(key order by key) into keys from json_object_keys(j_original->'mapping') key;
 if keys is distinct from array['content_sha256','language_code','mapping_sha256','selections','source_version_id']
  or exists(select 1 from jsonb_each(m) e where e.key<>'selections' and jsonb_typeof(e.value)<>'string')
  or m->>'content_sha256' is distinct from d->>'content_sha256' or m->>'source_version_id' is distinct from d->>'source_version_id'
  or m->>'mapping_sha256' !~ '^[a-f0-9]{64}$' or m->>'language_code' !~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$'
  or jsonb_typeof(m->'selections') is distinct from 'array' then
  raise exception using errcode='22023',message='invented_html_mapping_invalid';end if;
 if jsonb_array_length(m->'selections') not between 1 and 128 then raise exception using errcode='22023',message='invented_html_mapping_invalid';end if;
 select array_agg(key order by key) into keys from json_object_keys(j_original->'snapshot') key;
 if keys is distinct from array['content_sha256','item_key','language_code','mapping_sha256','passages','source_key','source_version_id']
  or exists(select 1 from jsonb_each(s) e where e.key<>'passages' and jsonb_typeof(e.value)<>'string')
  or s->>'content_sha256' is distinct from d->>'content_sha256' or s->>'source_version_id' is distinct from d->>'source_version_id'
  or s->>'source_key' is distinct from d->>'source_key' or s->>'item_key' is distinct from d->>'item_key'
  or s->>'mapping_sha256' is distinct from m->>'mapping_sha256' or s->>'language_code' is distinct from m->>'language_code'
  or jsonb_typeof(s->'passages') is distinct from 'array' then raise exception using errcode='22023',message='invented_html_snapshot_invalid';end if;
 manifest_original:=(j->>'derivation_manifest_json')::json;manifest:=manifest_original::jsonb;
 if jsonb_typeof(manifest) is distinct from 'object' then raise exception using errcode='22023',message='invented_html_manifest_invalid';end if;
 select array_agg(key order by key) into keys from json_object_keys(manifest_original) key;
 if keys is distinct from array['adapter_identity','content_sha256','coverage','item_key','language_code','mapping_sha256','original_bytes','parser_identity','rendered_visibility_verified','retrieved_at','schema_version','source_key','source_url','source_version_id','spans']
  or manifest->'schema_version' is distinct from '1'::jsonb or manifest->>'adapter_identity' is distinct from j->>'adapter_identity'
  or manifest->>'parser_identity' is distinct from j->>'parser_identity'
  or manifest->>'coverage' is distinct from 'selected_elements_parsed_text_only' or manifest->'rendered_visibility_verified' is distinct from 'false'::jsonb
  or manifest->'original_bytes' is distinct from to_jsonb(octet_length(p_raw))
  or j->>'derivation_manifest_sha256' is distinct from encode(sha256(convert_to(j->>'derivation_manifest_json','UTF8')),'hex')
  or manifest->>'source_key' is distinct from d->>'source_key' or manifest->>'item_key' is distinct from d->>'item_key'
  or manifest->>'source_version_id' is distinct from d->>'source_version_id' or manifest->>'source_url' is distinct from d->>'source_url'
  or manifest->>'content_sha256' is distinct from d->>'content_sha256'
  or manifest->>'mapping_sha256' is distinct from m->>'mapping_sha256' or manifest->>'language_code' is distinct from m->>'language_code'
  or jsonb_typeof(manifest->'retrieved_at') is distinct from 'string'
  or (manifest->>'retrieved_at')::timestamptz is distinct from (d->>'retrieved_at')::timestamptz
  or jsonb_typeof(manifest->'spans') is distinct from 'array' then
  raise exception using errcode='22023',message='invented_html_manifest_invalid';end if;
 if jsonb_array_length(s->'passages')<>jsonb_array_length(m->'selections') or jsonb_array_length(manifest->'spans')<>jsonb_array_length(m->'selections') then
  raise exception using errcode='22023',message='invented_html_span_invalid';end if;
 for position in 0..jsonb_array_length(m->'selections')-1 loop
  selection:=m->'selections'->position;span:=manifest->'spans'->position;passage:=s->'passages'->position;
  if jsonb_typeof(selection) is distinct from 'object' or jsonb_typeof(span) is distinct from 'object' or jsonb_typeof(passage) is distinct from 'object' then
   raise exception using errcode='22023',message='invented_html_span_invalid';end if;
  select array_agg(key order by key) into keys from json_object_keys(j_original->'mapping'->'selections'->position) key;
  if keys is distinct from array['element_id','locator'] or exists(select 1 from jsonb_each(selection) e where jsonb_typeof(e.value)<>'string')
   or char_length(selection->>'locator') not between 1 and 200 or selection->>'locator'=any(locators)
   or selection->>'element_id' !~ '^[A-Za-z][A-Za-z0-9_.:-]{0,119}$' or selection->>'element_id'=any(ids) then
   raise exception using errcode='22023',message='invented_html_selection_invalid';end if;
  select array_agg(key order by key) into keys from json_object_keys(manifest_original->'spans'->position) key;
  if keys is distinct from array['derived_text_sha256','element_id','end','locator','raw_sha256','start','tag']
   or exists(select 1 from jsonb_each(span) e where e.key not in ('start','end') and jsonb_typeof(e.value)<>'string')
   or jsonb_typeof(span->'start') is distinct from 'number' or span->>'start' !~ '^(0|[1-9][0-9]{0,4})$'
   or jsonb_typeof(span->'end') is distinct from 'number' or span->>'end' !~ '^[1-9][0-9]{0,4}$'
   or span->>'locator' is distinct from selection->>'locator' or span->>'element_id' is distinct from selection->>'element_id'
   or span->>'tag' !~ '^[a-z][a-z0-9:-]{0,31}$' then raise exception using errcode='22023',message='invented_html_span_invalid';end if;
  span_start:=(span->>'start')::integer;span_end:=(span->>'end')::integer;
  if span_start<previous_end or span_end<=span_start or span_end>octet_length(p_raw)
   or span->>'raw_sha256' is distinct from encode(sha256(substring(p_raw from span_start+1 for span_end-span_start)),'hex') then
   raise exception using errcode='22023',message='invented_html_span_invalid';end if;
  select array_agg(key order by key) into keys from json_object_keys(j_original->'snapshot'->'passages'->position) key;
  if keys is distinct from array['locator','text','text_sha256'] or exists(select 1 from jsonb_each(passage) e where jsonb_typeof(e.value)<>'string')
   or passage->>'locator' is distinct from selection->>'locator' or octet_length(passage->>'text') not between 1 and 8192
   or passage->>'text_sha256' is distinct from encode(sha256(convert_to(passage->>'text','UTF8')),'hex')
   or passage->>'text_sha256' is distinct from span->>'derived_text_sha256' then
   raise exception using errcode='22023',message='invented_html_derived_hash_invalid';end if;
  total:=total+octet_length(passage->>'text');if total>65536 then raise exception using errcode='22023',message='invented_html_derived_limit';end if;
  previous_end:=span_end;locators:=array_append(locators,selection->>'locator');ids:=array_append(ids,selection->>'element_id');
 end loop;
 -- Only this new tiny laboratory table is serialized; no old object is locked.
 lock table tf_html_rehearsal.originals in exclusive mode;
 select * into old from tf_html_rehearsal.originals where operation_id=operation;
 if found then
  if old.raw is distinct from p_raw or old.metadata is distinct from p_metadata then raise exception using errcode='23505',message='invented_html_operation_conflict';end if;
  return tf_html_rehearsal.original_receipt(operation);
 end if;
 insert into tf_html_rehearsal.originals(operation_id,raw,metadata,stored_at) values(operation,p_raw,p_metadata,clock_timestamp());
 -- A bounded-receipt failure remains in this same transaction and rolls back.
 return tf_html_rehearsal.original_receipt(operation);
end$$;
revoke all on all functions in schema tf_html_rehearsal from public;
