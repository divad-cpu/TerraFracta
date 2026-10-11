-- Owner-only atomic activation candidate; requires the pending admission and
-- work lease controls. No app writer, source, credential or schedule is granted.

create table terra_private.machine_publication_activations (
 publication_id uuid primary key references terra_private.issue_publications(id),
 decision_id uuid not null unique references terra_private.machine_candidate_decisions(id),
 run_id uuid not null references terra_private.update_runs(id),
 work_claim_id uuid not null references terra_private.update_run_work_claims(id),
 expected_head uuid references terra_private.issue_publications(id),
 request_fingerprint text not null check(request_fingerprint~'^[0-9a-f]{64}$'),
 publication_sha256 text not null check(publication_sha256~'^[0-9a-f]{64}$'),
 activated_at timestamptz not null default clock_timestamp() check(isfinite(activated_at))
);
create index machine_activations_run_idx on terra_private.machine_publication_activations(run_id,activated_at);
create index machine_activations_work_claim_idx on terra_private.machine_publication_activations(work_claim_id);
create index machine_activations_predecessor_idx on terra_private.machine_publication_activations(expected_head)
 where expected_head is not null;
alter table terra_private.machine_publication_activations enable row level security;
revoke all on terra_private.machine_publication_activations from public,anon,authenticated,
 service_role,terra_collector,terra_operator,terra_reviewer,terra_issue_reader;
grant select on terra_private.machine_publication_activations to terra_operator,terra_reviewer;
create policy operator_read on terra_private.machine_publication_activations for select to terra_operator using(true);
create policy reviewer_read on terra_private.machine_publication_activations for select to terra_reviewer using(true);
create trigger machine_publication_activation_immutable before update or delete
 on terra_private.machine_publication_activations for each row
 execute function terra_private.block_automatic_decision_change();

create function terra_private.machine_publication_hash(p terra_private.issue_publications)
returns text language sql stable strict security invoker
set search_path=pg_catalog,pg_temp as $hash$
 select encode(sha256(convert_to(jsonb_build_object('schemaVersion',1,
   'id',p.id,'issueId',p.issue_id,'revision',p.revision,'previousPublicationId',p.predecessor_id,
   'kind',p.publication_kind,'snapshot',p.snapshot,'dependencyManifest',p.dependency_manifest,
   'createdAt',to_char(p.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text,'UTF8')),'hex');
$hash$;

create function terra_private.check_machine_publication_activation()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,pg_temp as $guard$
declare
 d terra_private.machine_candidate_decisions%rowtype;
 q terra_private.automatic_route_qualifications%rowtype;
 s terra_private.source_registrations%rowtype;
 v terra_private.source_versions%rowtype;
 r terra_private.update_runs%rowtype;
 p terra_private.issue_publications%rowtype;
 now_at timestamptz;
begin
 select * into d from terra_private.machine_candidate_decisions where id=new.decision_id;
 select * into q from terra_private.automatic_route_qualifications where id=d.qualification_id;
 select * into s from terra_private.source_registrations where id=q.registration_id for update;
 select * into v from terra_private.source_versions where id=d.source_version_id for update;
 select * into r from terra_private.update_runs where id=new.run_id for update;
 perform terra_private.assert_update_run_work(new.run_id,new.request_fingerprint,new.work_claim_id);
 select * into p from terra_private.issue_publications where id=new.publication_id for update;
 now_at:=clock_timestamp();
 if d.id is null or q.id is null or s.id is null or v.id is null or r.id is null or p.id is null
    or d.run_id<>r.id or d.disposition<>'eligible'
    or r.mode<>'publish_eligible' or r.run_state<>'running'
    or r.request_fingerprint is distinct from new.request_fingerprint
    or r.policy_version is distinct from q.policy_version
    or r.commit_state<>'partial' or r.visibility_state<>'pending'
    or s.registration_state<>'approved' or not s.allow_fetch or not s.fetch_enabled
    or not s.allow_public_derived or s.reviewed_at is null or not isfinite(s.reviewed_at)
    or s.reviewed_at>now_at or s.exact_endpoint is distinct from q.exact_endpoint
    or q.decision<>'qualified' or q.revision<>(select max(revision)
       from terra_private.automatic_route_qualifications where registration_id=s.id and change_class=q.change_class)
    or q.qualification_expires_at is null or now_at>=q.qualification_expires_at
    or not isfinite(q.qualification_expires_at) or not isfinite(q.decided_at)
    or not isfinite(d.decided_at) or d.decided_at<q.decided_at or d.decided_at>new.activated_at
    or v.registration_id<>s.id or v.source_url is distinct from q.exact_endpoint
    or v.content_sha256 is distinct from d.content_sha256
    or v.id is distinct from (select id from terra_private.source_versions
       where registration_id=s.id and item_key=v.item_key order by retrieved_at desc,id desc limit 1)
    or new.publication_sha256 is distinct from terra_private.machine_publication_hash(p)
    or p.predecessor_id is distinct from new.expected_head
    or p.publication_kind not in('accepted','correction')
    or not isfinite(p.created_at) or p.created_at>new.activated_at or new.activated_at>now_at
    or not exists(select 1 from terra_private.issue_heads where issue_id=p.issue_id and current_publication_id=p.id)
    or not exists(select 1 from terra_private.issue_publication_machine_bindings
       where publication_id=p.id and decision_id=d.id) then
   raise exception 'Activation authority or receipt is not current' using errcode='23514';
 end if;
 return new;
end;
$guard$;
create trigger machine_publication_activation_insert_guard before insert
 on terra_private.machine_publication_activations for each row
 execute function terra_private.check_machine_publication_activation();
-- Check again at transaction end, including wall-clock expiry after lock waits.
create constraint trigger machine_publication_activation_commit_guard after insert
 on terra_private.machine_publication_activations deferrable initially deferred
 for each row execute function terra_private.check_machine_publication_activation();

create function terra_private.block_activated_publication_change()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,pg_temp as $guard$
begin
 if exists(select 1 from terra_private.machine_publication_activations where publication_id=old.id) then
   raise exception 'Activated publication is immutable' using errcode='23514';
 end if;
 return new;
end;
$guard$;
create trigger activated_publication_immutable before update
 on terra_private.issue_publications for each row
 execute function terra_private.block_activated_publication_change();

create function terra_private.activate_machine_publication(
 p_publication uuid,p_decision uuid,p_expected_head uuid,p_fingerprint text,p_lease uuid,
 p_publication_sha256 text)
returns jsonb language plpgsql volatile security invoker
set search_path=pg_catalog,pg_temp as $activate$
declare
 d terra_private.machine_candidate_decisions%rowtype;
 q terra_private.automatic_route_qualifications%rowtype;
 s terra_private.source_registrations%rowtype;
 v terra_private.source_versions%rowtype;
 r terra_private.update_runs%rowtype;
 p terra_private.issue_publications%rowtype;
 h terra_private.issue_heads%rowtype;
 j terra_private.jurisdictions%rowtype;
 dossier terra_private.issue_dossiers%rowtype;
 c terra_private.claims%rowtype;
 sr terra_private.source_display_reviews%rowtype;
 ir terra_private.issue_text_reviews%rowtype;
 pr terra_private.claim_period_reviews%rowtype;
 ar terra_private.claim_assertion_reviews%rowtype;
 prior terra_private.machine_publication_activations%rowtype;
 candidate jsonb;
 claim jsonb;
 evidence jsonb;
 now_at timestamptz;
begin
 if p_publication is null or p_decision is null or p_fingerprint is null
    or p_fingerprint !~ '^[0-9a-f]{64}$' or p_lease is null
    or p_publication_sha256 is null or p_publication_sha256 !~ '^[0-9a-f]{64}$' then
   raise exception 'Activation request is invalid' using errcode='23514';
 end if;
 -- Replaying a committed immutable receipt does not restart work or assert
 -- that its old publication is still the head or publicly visible.
 select * into prior from terra_private.machine_publication_activations where publication_id=p_publication or decision_id=p_decision;
 if prior.publication_id is not null then
   select * into p from terra_private.issue_publications where id=p_publication;
   if prior.publication_id<>p_publication or prior.decision_id<>p_decision or prior.expected_head is distinct from p_expected_head
      or prior.request_fingerprint is distinct from p_fingerprint
      or prior.publication_sha256 is distinct from p_publication_sha256
      or prior.publication_sha256 is distinct from terra_private.machine_publication_hash(p) then
     raise exception 'Activation replay conflicts with receipt' using errcode='23514';
   end if;
   return jsonb_build_object('schemaVersion',1,'status','already_activated',
      'publicationId',prior.publication_id,'decisionId',prior.decision_id,'runId',prior.run_id,
      'requestFingerprint',prior.request_fingerprint,'publicationSha256',prior.publication_sha256,'activatedAt',prior.activated_at,
      'visibilityState','pending','currentHeadMatches',exists(select 1 from terra_private.issue_heads
        where issue_id=p.issue_id and current_publication_id=p.id),'candidate',null);
 end if;
 select * into d from terra_private.machine_candidate_decisions where id=p_decision;
 select * into q from terra_private.automatic_route_qualifications where id=d.qualification_id;
 select * into s from terra_private.source_registrations where id=q.registration_id for update;
 select * into v from terra_private.source_versions where id=d.source_version_id for update;
 select * into r from terra_private.update_runs where id=d.run_id for update;
 -- A second identical call may have waited while the first committed.
 select * into p from terra_private.issue_publications where id=p_publication;
 select * into prior from terra_private.machine_publication_activations where publication_id=p_publication or decision_id=p_decision;
 if prior.publication_id is not null then
   if prior.publication_id<>p_publication or prior.decision_id<>p_decision or prior.expected_head is distinct from p_expected_head
      or prior.request_fingerprint is distinct from p_fingerprint
      or prior.publication_sha256 is distinct from p_publication_sha256
      or prior.publication_sha256 is distinct from terra_private.machine_publication_hash(p) then
     raise exception 'Activation replay conflicts with receipt' using errcode='23514';
   end if;
   return jsonb_build_object('schemaVersion',1,'status','already_activated',
      'publicationId',prior.publication_id,'decisionId',prior.decision_id,'runId',prior.run_id,
      'requestFingerprint',prior.request_fingerprint,'publicationSha256',prior.publication_sha256,'activatedAt',prior.activated_at,
      'visibilityState','pending','currentHeadMatches',exists(select 1 from terra_private.issue_heads where issue_id=p.issue_id and current_publication_id=p.id),'candidate',null);
 end if;
 perform terra_private.assert_update_run_work(r.id,p_fingerprint,p_lease);
 select * into p from terra_private.issue_publications where id=p_publication;
 select * into j from terra_private.jurisdictions where id=r.jurisdiction_id for update;
 select * into dossier from terra_private.issue_dossiers where id=p.issue_id for update;
 select * into h from terra_private.issue_heads where issue_id=dossier.id for update;
 select * into p from terra_private.issue_publications where id=p_publication for update;
 if d.id is null or q.id is null or s.id is null or v.id is null or r.id is null
    or p.id is null or j.id is null or dossier.id is null or h.issue_id is null
    or terra_private.machine_publication_hash(p) is distinct from p_publication_sha256
    or d.disposition<>'eligible' or r.mode<>'publish_eligible'
    or r.commit_state not in('none','partial') or r.visibility_state not in('not_required','pending')
    or j.coverage_state<>'published' or dossier.editorial_state<>'accepted'
    or dossier.jurisdiction_id<>r.jurisdiction_id or p.issue_id<>dossier.id
    or p.snapshot->>'jurisdictionSlug' is distinct from j.public_slug
    or p.snapshot->>'issueSlug' is distinct from dossier.public_slug
    or p.publication_kind not in('accepted','correction')
    or p.predecessor_id is distinct from p_expected_head
    or h.current_publication_id is distinct from p_expected_head
    or not terra_private.is_closed_public_issue_payload(p.snapshot,p.dependency_manifest) then
   raise exception 'Activation scope, run or predecessor is invalid' using errcode='23514';
 end if;
 if jsonb_array_length(p.snapshot->'claims')<>1 then
   raise exception 'Activation requires one selected condition' using errcode='23514';
 end if;
 claim:=p.snapshot #> '{claims,0}';
 if jsonb_array_length(claim->'evidence')<>1 then
   raise exception 'Activation requires one selected condition' using errcode='23514';
 end if;
 evidence:=claim #> '{evidence,0}';
 select * into c from terra_private.claims where id=(claim->>'id')::uuid for update;
 if c.id is null or c.issue_id<>p.issue_id or c.claim_type<>'condition' or c.evidence_state<>'supported'
    or claim->>'type'<>'condition' or claim->>'assertion' is distinct from c.assertion
    or evidence->>'sourceVersionId' is distinct from v.id::text
    or evidence->>'locator' is distinct from d.evidence_locator
    or evidence->>'url' is distinct from d.public_citation_url
    or evidence->>'publisher' is distinct from s.publisher or evidence->>'relation'<>'supports'
    or (evidence->>'retrievedAt')::timestamptz is distinct from v.retrieved_at
    or p.dependency_manifest is distinct from jsonb_build_object('sourceVersionIds',jsonb_build_array(v.id))
    or (select count(*) from terra_private.issue_publication_citations where publication_id=p.id)<>1 then
   raise exception 'Activation evidence is not selected' using errcode='23514';
 end if;
 select * into sr from terra_private.source_display_reviews where source_version_id=v.id order by revision desc limit 1;
 select * into ir from terra_private.issue_text_reviews where publication_id=p.id order by revision desc limit 1;
 select * into pr from terra_private.claim_period_reviews where publication_id=p.id and claim_id=c.id order by revision desc limit 1;
 select * into ar from terra_private.claim_assertion_reviews where publication_id=p.id and claim_id=c.id order by revision desc limit 1;
 now_at:=clock_timestamp();
 if sr.source_version_id is null or ir.publication_id is null or pr.publication_id is null or ar.publication_id is null
    or sr.decision<>'accepted' or ir.decision<>'accepted' or pr.decision<>'accepted' or ar.decision<>'accepted'
    or sr.display_title is distinct from evidence->>'title' or sr.title_language<>'en'
    or ir.display_title is distinct from p.snapshot->>'title' or ir.display_summary is distinct from p.snapshot->>'summary'
    or pr.period_label is distinct from claim->>'periodLabel' or ar.claim_type is distinct from c.claim_type
    or ar.display_assertion is distinct from c.assertion
    or not isfinite(sr.reviewed_at) or not isfinite(ir.reviewed_at)
    or not isfinite(pr.reviewed_at) or not isfinite(ar.reviewed_at)
    or greatest(sr.reviewed_at,ir.reviewed_at,pr.reviewed_at,ar.reviewed_at)>now_at then
   raise exception 'Activation display decisions are not current' using errcode='23514';
 end if;
 insert into terra_private.issue_publication_machine_bindings(publication_id,claim_id,decision_id)
   values(p.id,c.id,d.id);
 update terra_private.issue_heads set current_publication_id=p.id,changed_at=transaction_timestamp()
   where issue_id=p.issue_id;
 update terra_private.update_runs set commit_state='partial',visibility_state='pending' where id=r.id;
 insert into terra_private.machine_publication_activations(publication_id,decision_id,run_id,
   work_claim_id,expected_head,request_fingerprint,publication_sha256)
   values(p.id,d.id,r.id,p_lease,p_expected_head,p_fingerprint,terra_private.machine_publication_hash(p))
   returning * into prior;
 candidate:=terra_private.read_issue_candidate(j.public_slug,dossier.public_slug);
 if candidate is null or candidate ? 'candidate_state'
    or candidate #>> '{publication,id}' is distinct from p.id::text then
   raise exception 'Activated candidate is not readable' using errcode='23514';
 end if;
 return jsonb_build_object('schemaVersion',1,'status','activated',
    'publicationId',p.id,'decisionId',d.id,'runId',r.id,'requestFingerprint',prior.request_fingerprint,
    'publicationSha256',prior.publication_sha256,
    'activatedAt',prior.activated_at,'visibilityState','pending','currentHeadMatches',true,'candidate',candidate);
exception when invalid_text_representation or datetime_field_overflow then
 raise exception 'Activation request is invalid' using errcode='23514';
end;
$activate$;

revoke all on function terra_private.machine_publication_hash(terra_private.issue_publications),
 terra_private.check_machine_publication_activation(),terra_private.block_activated_publication_change(),
 terra_private.activate_machine_publication(uuid,uuid,uuid,text,uuid,text)
 from public,anon,authenticated,service_role,terra_collector,terra_operator,terra_reviewer,terra_issue_reader;
