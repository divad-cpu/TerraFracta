-- Draft only. No primary installation, table grants, LOGIN or runtime binding.
-- Broad existing reviewer inspection, not a confined credential/public reader.
-- Trusted unconditional reviewer RLS visibility is required: plain invoker
-- queries cannot distinguish an invisible unreferenced child from absence.
create function terra_private.read_operator_audit(
  p_run uuid, p_issue uuid, p_latest_revision integer default null,
  p_head uuid default null, p_before_revision integer default null)
returns jsonb language plpgsql stable security invoker
set search_path = '' as $audit$
declare
  r terra_private.update_runs%rowtype;
  i terra_private.issue_dossiers%rowtype;
  m terra_private.update_run_manifests%rowtype;
  reg terra_private.source_registrations%rowtype;
  c terra_private.update_run_source_checks%rowtype;
  v terra_private.source_versions%rowtype;
  h terra_private.issue_heads%rowtype;
  head_revision integer; latest_revision integer; lowest_revision integer;
  table_name text; table_oid oid; policy_ok boolean;
  requested jsonb; cursor_value jsonb; manifest jsonb; entry jsonb;
  sources_text text; items_text text; rebuilt text;
  sources jsonb := '[]'::jsonb; publications jsonb; next_cursor jsonb := null;
  source_ids uuid[] := array[]::uuid[]; source_keys text[] := array[]::text[];
  source_id uuid; source_key text; known boolean := false; response jsonb;
  observed timestamptz := statement_timestamp();
  floor_time constant timestamptz := '0001-01-01T00:00:00Z';
  ceiling_time constant timestamptz := '10000-01-01T00:00:00Z';
  uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if current_setting('transaction_read_only') <> 'on' then
    raise exception 'Operator audit requires a read-only transaction' using errcode = '25006';
  end if;
  if current_user <> 'terra_reviewer' or not exists (
    select 1 from pg_catalog.pg_roles where rolname = current_user
      and not rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole
      and not rolreplication and not rolbypassrls) then
    raise exception 'Operator audit reviewer configuration unavailable' using errcode = '42501';
  end if;
  foreach table_name in array array['jurisdictions','update_runs','issue_dossiers',
    'source_registrations','source_versions','update_run_source_checks',
    'update_run_manifests','issue_publications','issue_heads'] loop
    table_oid := pg_catalog.to_regclass('terra_private.' || table_name);
    if table_oid is null or not pg_catalog.has_table_privilege(current_user, table_oid, 'SELECT')
      or not exists (select 1 from pg_catalog.pg_class where oid = table_oid
        and relkind = 'r' and relrowsecurity) then
      raise exception 'Operator audit read configuration unavailable' using errcode = '42501';
    end if;
    -- Literal-true permissive visibility requires effective inherited USAGE;
    -- MEMBER alone can be NOINHERIT and does not establish RLS visibility.
    -- Restrictive filters use the same effective applicability, including PUBLIC.
    select exists (select 1 from pg_catalog.pg_policy p where p.polrelid = table_oid
      and p.polcmd in ('r','*') and p.polpermissive
      and pg_catalog.pg_get_expr(p.polqual,p.polrelid) = 'true'
      and exists (select 1 from unnest(p.polroles) role_id where case when role_id = 0 then true
        else pg_catalog.pg_has_role(current_user,role_id,'USAGE') end))
      and not exists (select 1 from pg_catalog.pg_policy p where p.polrelid = table_oid
        and p.polcmd in ('r','*') and not p.polpermissive
        and pg_catalog.pg_get_expr(p.polqual,p.polrelid) is distinct from 'true'
        and exists (select 1 from unnest(p.polroles) role_id where case when role_id = 0 then true
          else pg_catalog.pg_has_role(current_user,role_id,'USAGE') end))
      into policy_ok;
    if not policy_ok then
      raise exception 'Operator audit visibility configuration unavailable' using errcode = '42501';
    end if;
  end loop;
  if p_run is null or p_issue is null then
    raise exception 'Operator audit scope invalid' using errcode = '23514';
  end if;
  if p_latest_revision is null and p_head is null and p_before_revision is null then
    cursor_value := null;
  elsif p_latest_revision is not null and p_before_revision is not null
    and p_latest_revision >= 1 and p_before_revision between 1 and p_latest_revision then
    cursor_value := jsonb_build_object('latestRevision',p_latest_revision,
      'headPublicationId',p_head,'beforeRevision',p_before_revision);
  else
    raise exception 'Operator audit cursor invalid' using errcode = '23514';
  end if;
  requested := jsonb_build_object('runId',p_run,'issueId',p_issue,'cursor',cursor_value);
  select * into r from terra_private.update_runs where id = p_run;
  select * into i from terra_private.issue_dossiers where id = p_issue;
  if r.id is null or i.id is null or r.jurisdiction_id <> i.jurisdiction_id then
    return jsonb_build_object('schemaVersion',1,'status','not_found','requested',requested);
  end if;
  if not exists (select 1 from terra_private.jurisdictions where id = r.jurisdiction_id)
    or r.jurisdiction_id !~ '^[a-z0-9][a-z0-9:-]{0,79}$'
    or not isfinite(r.created_at) or r.created_at < floor_time or r.created_at >= ceiling_time
    or r.created_at > observed or (r.finished_at is not null and
      (not isfinite(r.finished_at) or r.finished_at < r.created_at or r.finished_at > observed
        or r.finished_at >= ceiling_time)) then
    raise exception 'Operator audit recorded dependency invalid' using errcode = '23514';
  end if;
  select coalesce(max(revision),0) into latest_revision
    from terra_private.issue_publications where issue_id = i.id;
  select * into h from terra_private.issue_heads where issue_id = i.id;
  if h.current_publication_id is not null then
    select revision into head_revision from terra_private.issue_publications
      where id = h.current_publication_id and issue_id = i.id;
    if head_revision is null or h.changed_at is null or not isfinite(h.changed_at)
      or h.changed_at < floor_time or h.changed_at >= ceiling_time or h.changed_at > observed then
      raise exception 'Operator audit head dependency invalid' using errcode = '23514';
    end if;
  elsif h.changed_at is not null then
    raise exception 'Operator audit head dependency invalid' using errcode = '23514';
  end if;
  if cursor_value is not null and (p_latest_revision <> latest_revision
    or p_head is distinct from h.current_publication_id) then
    return jsonb_build_object('schemaVersion',1,'status','changed','requested',requested);
  end if;
  if cursor_value is not null and not exists (select 1 from terra_private.issue_publications
    where issue_id = i.id and revision = p_before_revision) then
    raise exception 'Operator audit cursor revision unavailable' using errcode = '23514';
  end if;
  -- Validate metadata and referenced parents across the issue, including rows
  -- outside this page. Gaps are allowed; no consecutive revision is invented.
  if exists (select 1 from terra_private.issue_publications p
    left join terra_private.issue_publications parent on parent.id = p.predecessor_id
    where p.issue_id = i.id and (not isfinite(p.created_at) or p.created_at < floor_time
      or p.created_at >= ceiling_time or p.created_at > observed or p.revision < 1
      or (p.predecessor_id is not null and (parent.id is null or parent.issue_id <> i.id
        or parent.revision >= p.revision or parent.created_at > p.created_at))))
    or (h.current_publication_id is not null and exists (select 1 from terra_private.issue_publications p
      where p.id = h.current_publication_id and p.created_at > h.changed_at)) then
    raise exception 'Operator audit publication dependency invalid' using errcode = '23514';
  end if;
  select * into m from terra_private.update_run_manifests where run_id = r.id;
  if m.run_id is not null then
    known := true;
    if octet_length(m.canonical_manifest) not between 2 and 40960 then
      raise exception 'Operator audit manifest invalid' using errcode = '23514';
    end if;
    manifest := m.canonical_manifest::jsonb;
    if jsonb_typeof(manifest) is distinct from 'object' or
      (select array_agg(key order by key collate "C") from jsonb_each(manifest)) is distinct from
        array['items','mode','requestFingerprint','runId','schemaVersion','sources']::text[]
      or manifest->'schemaVersion' is distinct from '1'::jsonb
      or jsonb_typeof(manifest->'runId') is distinct from 'string'
      or jsonb_typeof(manifest->'requestFingerprint') is distinct from 'string'
      or jsonb_typeof(manifest->'mode') is distinct from 'string'
      or manifest->>'runId' is distinct from r.id::text
      or manifest->>'requestFingerprint' is distinct from r.request_fingerprint
      or manifest->>'mode' is distinct from r.mode
      or jsonb_typeof(manifest->'sources') is distinct from 'array'
      or jsonb_typeof(manifest->'items') is distinct from 'array'
      or m.manifest_sha256 is distinct from encode(sha256(convert_to(m.canonical_manifest,'UTF8')),'hex')
      or not isfinite(m.captured_at) or m.captured_at < r.created_at or m.captured_at > observed then
      raise exception 'Operator audit manifest invalid' using errcode = '23514';
    end if;
    if jsonb_array_length(manifest->'sources') not between 1 and 50
      or jsonb_array_length(manifest->'items') > 50 then
      raise exception 'Operator audit manifest invalid' using errcode = '23514';
    end if;
    for entry in select value from jsonb_array_elements(manifest->'sources') loop
      if jsonb_typeof(entry) is distinct from 'object' or
        (select array_agg(key order by key collate "C") from jsonb_each(entry)) is distinct from
          array['contentSha256','registrationId','sourceKey','sourceVersionId']::text[]
        or jsonb_typeof(entry->'registrationId') is distinct from 'string' or entry->>'registrationId' !~ uuid_pattern
        or jsonb_typeof(entry->'sourceKey') is distinct from 'string' or entry->>'sourceKey' !~ '^[a-z0-9][a-z0-9:-]{0,119}$'
        or (entry->'sourceVersionId' is distinct from 'null'::jsonb and
          (jsonb_typeof(entry->'sourceVersionId') is distinct from 'string' or entry->>'sourceVersionId' !~ uuid_pattern))
        or ((entry->'sourceVersionId' = 'null'::jsonb) is distinct from (entry->'contentSha256' = 'null'::jsonb))
        or (entry->'contentSha256' is distinct from 'null'::jsonb and
          (jsonb_typeof(entry->'contentSha256') is distinct from 'string' or entry->>'contentSha256' !~ '^[0-9a-f]{64}$')) then
        raise exception 'Operator audit manifest source invalid' using errcode = '23514';
      end if;
      if (entry->>'registrationId')::uuid = any(source_ids) or entry->>'sourceKey' = any(source_keys) then
        raise exception 'Operator audit manifest source duplicated' using errcode = '23514';
      end if;
      source_ids := array_append(source_ids,(entry->>'registrationId')::uuid);
      source_keys := array_append(source_keys,entry->>'sourceKey');
      select * into c from terra_private.update_run_source_checks
        where run_id = r.id and registration_id = (entry->>'registrationId')::uuid;
      if c.run_id is not null and (c.source_key is distinct from entry->>'sourceKey'
        or c.source_version_id::text is distinct from entry->>'sourceVersionId'
        or c.content_sha256 is distinct from entry->>'contentSha256' or c.checked_at > m.captured_at) then
        raise exception 'Operator audit manifest check binding invalid' using errcode = '23514';
      end if;
      if entry->>'sourceVersionId' is not null and c.run_id is null then
        raise exception 'Operator audit manifest capture unavailable' using errcode = '23514';
      end if;
    end loop;
    if exists (select 1 from terra_private.update_run_source_checks
      where run_id = r.id and not (registration_id = any(source_ids))) then
      raise exception 'Operator audit check outside expected set' using errcode = '23514';
    end if;
    for entry in select value from jsonb_array_elements(manifest->'items') loop
      if jsonb_typeof(entry) is distinct from 'object' or
        (select array_agg(key order by key collate "C") from jsonb_each(entry)) is distinct from
          array['itemKey','sourceKey','sourceVersionId']::text[]
        or jsonb_typeof(entry->'itemKey') is distinct from 'string' or entry->>'itemKey' !~ '^[a-z0-9][a-z0-9:-]{0,119}$'
        or jsonb_typeof(entry->'sourceVersionId') is distinct from 'string' or entry->>'sourceVersionId' !~ uuid_pattern
        or not exists (select 1 from jsonb_array_elements(manifest->'sources') s
          where s->>'sourceKey' = entry->>'sourceKey' and s->>'sourceVersionId' = entry->>'sourceVersionId') then
        raise exception 'Operator audit manifest item invalid' using errcode = '23514';
      end if;
    end loop;
    if (select count(*) <> count(distinct value->>'itemKey') from jsonb_array_elements(manifest->'items')) then
      raise exception 'Operator audit manifest item duplicated' using errcode = '23514';
    end if;
    -- Reuse the existing immutable manifest's exact canonical ASCII encoding;
    -- reviewer has no EXECUTE on its writer validator, so no helper grant is added.
    select '[' || coalesce(string_agg('{"contentSha256":' || (value->'contentSha256')::text ||
      ',"registrationId":' || (value->'registrationId')::text || ',"sourceKey":' || (value->'sourceKey')::text ||
      ',"sourceVersionId":' || (value->'sourceVersionId')::text || '}', ',' order by value->>'sourceKey' collate "C"),'') || ']'
      into sources_text from jsonb_array_elements(manifest->'sources');
    select '[' || coalesce(string_agg('{"itemKey":' || (value->'itemKey')::text || ',"sourceKey":' ||
      (value->'sourceKey')::text || ',"sourceVersionId":' || (value->'sourceVersionId')::text || '}',
      ',' order by value->>'itemKey' collate "C"),'') || ']' into items_text from jsonb_array_elements(manifest->'items');
    rebuilt := '{"items":' || items_text || ',"mode":' || (manifest->'mode')::text ||
      ',"requestFingerprint":' || (manifest->'requestFingerprint')::text || ',"runId":' ||
      (manifest->'runId')::text || ',"schemaVersion":1,"sources":' || sources_text || '}';
    if rebuilt is distinct from m.canonical_manifest then
      raise exception 'Operator audit canonical manifest invalid' using errcode = '23514';
    end if;
  else
    select coalesce(array_agg(registration_id),array[]::uuid[]) into source_ids
      from terra_private.update_run_source_checks where run_id = r.id;
  end if;
  if cardinality(source_ids) > 50 then
    raise exception 'Operator audit source bound exceeded' using errcode = '23514';
  end if;
  for source_id in select ids.id from unnest(source_ids) ids(id)
    order by (select registration.source_key from terra_private.source_registrations registration
      where registration.id = ids.id) collate "C" loop
    select * into reg from terra_private.source_registrations where id = source_id;
    select * into c from terra_private.update_run_source_checks where run_id = r.id and registration_id = source_id;
    source_key := case when known then source_keys[array_position(source_ids,source_id)] else c.source_key end;
    if reg.id is null or reg.source_key is distinct from source_key or source_key !~ '^[a-z0-9][a-z0-9:-]{0,119}$'
      or (reg.registration_state = 'approved' and reg.reviewed_at is null)
      or (reg.fetch_enabled and (reg.registration_state <> 'approved' or not reg.allow_fetch))
      or (reg.reviewed_at is not null and (not isfinite(reg.reviewed_at) or reg.reviewed_at < floor_time
        or reg.reviewed_at >= ceiling_time or reg.reviewed_at > observed))
      or (c.run_id is not null and (c.source_key is distinct from reg.source_key or not isfinite(c.checked_at)
        or c.checked_at < r.created_at or c.checked_at > observed
        or ((c.outcome in ('captured','unchanged')) is distinct from (c.source_version_id is not null)))) then
      raise exception 'Operator audit source dependency invalid' using errcode = '23514';
    end if;
    if c.source_version_id is not null then
      select * into v from terra_private.source_versions where id = c.source_version_id;
      if v.id is null or v.registration_id <> reg.id or v.content_sha256 is distinct from c.content_sha256
        or not isfinite(v.retrieved_at) or v.retrieved_at < floor_time or v.retrieved_at > c.checked_at then
        raise exception 'Operator audit version dependency invalid' using errcode = '23514';
      end if;
    end if;
    sources := sources || jsonb_build_array(jsonb_build_object('registrationId',reg.id,'sourceKey',reg.source_key,
      'registrationState',reg.registration_state,'allowFetch',reg.allow_fetch,'fetchEnabled',reg.fetch_enabled,
      'reviewedAt',case when reg.reviewed_at is null then null else to_char(reg.reviewed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
      'outcome',case when c.run_id is null then 'not_recorded' else c.outcome end,
      'checkedAt',case when c.run_id is null then null else to_char(c.checked_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
      'sourceVersionId',c.source_version_id));
  end loop;
  select coalesce(jsonb_agg(row_value order by revision desc),'[]'::jsonb),min(revision)
    into publications,lowest_revision from (
      select revision,jsonb_build_object('publicationId',id,'revision',revision,
        'supersedesPublicationId',predecessor_id,'publicationKind',publication_kind,
        'createdAt',to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'isHead',id is not distinct from h.current_publication_id) row_value
      from terra_private.issue_publications where issue_id = i.id
        and (p_before_revision is null or revision < p_before_revision)
      order by revision desc limit 20) page;
  if lowest_revision is not null and exists (select 1 from terra_private.issue_publications
    where issue_id = i.id and revision < lowest_revision) then
    next_cursor := jsonb_build_object('latestRevision',latest_revision,'headPublicationId',h.current_publication_id,
      'beforeRevision',lowest_revision);
  end if;
  response := jsonb_build_object('schemaVersion',1,'status','ok','requested',requested,
    'observedAt',to_char(observed at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'run',jsonb_build_object('runId',r.id,'jurisdictionId',r.jurisdiction_id,'mode',r.mode,
      'runState',r.run_state,'commitState',r.commit_state,'visibilityState',r.visibility_state,
      'createdAt',to_char(r.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'finishedAt',case when r.finished_at is null then null else to_char(r.finished_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end),
    'expectedSourcesKnown',known,'sources',sources,'history',jsonb_build_object('issueId',i.id,
      'latestRevision',latest_revision,'headPublicationId',h.current_publication_id,'headRevision',head_revision,
      'publications',publications,'nextCursor',next_cursor));
  if octet_length(response::text) > 65536 then
    raise exception 'Operator audit output bound exceeded' using errcode = '23514';
  end if;
  return response;
exception when invalid_text_representation then
  raise exception 'Operator audit recorded encoding invalid' using errcode = '23514';
end;
$audit$;
revoke all on function terra_private.read_operator_audit(uuid,uuid,integer,uuid,integer)
  from public,anon,authenticated,service_role,terra_collector,terra_operator;
grant execute on function terra_private.read_operator_audit(uuid,uuid,integer,uuid,integer) to terra_reviewer;
