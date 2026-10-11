"""Compose a closed two-context SSB-format fixture API, isolated only.

Reuses installed response/confirmation guards. It accepts only owner-pinned
fixture bodies and a shadow manifest. No real fetch, source qualification,
usable validation, public writer, LOGIN or primary migration is created.
"""
from pathlib import Path
import re
import sys
from workers.ssb_14059_capture import METADATA_URL, DATA_URL

ROOT=Path(__file__).resolve().parents[1]
SCHEMA='terra_pair_capture_test_api'


def once(body,old,new):
    if body.count(old)!=1:raise ValueError('Pinned paired API composition marker changed')
    return body.replace(old,new,1)


def build_fictional_ssb_pair_api():
    base=(ROOT/'research/pending/TF009_fictional_response_identity.sql').read_text().replace('terra_response_test_api',SCHEMA)
    base=once(base,' principal name primary key,',' principal name not null,\n response_kind text not null check(response_kind in(\'metadata\',\'data\')),')
    base=once(base,'max_body_bytes between 1 and 100','max_body_bytes=65536')
    base=once(base,' enabled boolean not null default false\n',""" enabled boolean not null default false,
 work_claim_id uuid not null references terra_private.update_run_work_claims(id),
 source_version_id uuid not null,
 body_sha256 text not null check(body_sha256~'^[0-9a-f]{64}$'),
 body_bytes integer not null check(body_bytes between 1 and 65536),
 pair_id uuid not null,
 trusted_manifest text not null check(octet_length(trusted_manifest) between 2 and 32768),
 primary key(principal,response_kind),unique(principal,registration_id)
""")
    base=once(base,f'create function {SCHEMA}.current_scope()',f'create function {SCHEMA}.current_scope(p_kind text)')
    base=once(base,f' select * into p from {SCHEMA}.principal_scopes where principal=session_user for share;',f""" if p_kind is null or p_kind not in('metadata','data') then
  raise exception 'Unknown closed pair response kind' using errcode='42501';
 end if;
 -- Serialize the whole principal before native run locks, preserving the
 -- previously verified lock order for operations on either context.
 perform 1 from {SCHEMA}.principal_scopes where principal=session_user order by response_kind for no key update;
 select * into p from {SCHEMA}.principal_scopes where principal=session_user and response_kind=p_kind;
""")
    old="""  or r.mode<>'shadow' or s.source_key is distinct from 'fictional-response'
  or s.exact_endpoint is distinct from 'https://example.org/fictional-response' then"""
    new="""  or r.mode<>'shadow' or s.source_key is distinct from ('ssb-14059-'||p_kind)
  or s.exact_endpoint is distinct from (case when p_kind='metadata' then %META% else %DATA% end)
  or s.registration_state<>'approved' or not s.allow_fetch or not s.fetch_enabled or s.allow_public_derived
  or p.work_claim_id is distinct from (select claim_id from terra_private.update_run_work_state where run_id=p.run_id)
  or p.body_bytes>p.max_body_bytes then""".replace('%META%',"'"+METADATA_URL+"'").replace('%DATA%',"'"+DATA_URL+"'")
    base=once(base,old,new)
    base=once(base,f'reserve_response(p_key text,p_max_body integer)', 'reserve_response(p_kind text)')
    base=once(base,' r terra_private.update_runs%rowtype; w terra_private.update_run_work_state%rowtype;\nbegin\n'," r terra_private.update_runs%rowtype; w terra_private.update_run_work_state%rowtype;\n p_key text;p_max_body integer;\nbegin\n")
    base=base.replace(f'p:={SCHEMA}.current_scope();',f'p:={SCHEMA}.current_scope(p_kind);')
    base=once(base,' if p_max_body is null or p_max_body<1 or p_max_body>p.max_body_bytes then'," p_key:='fictional:ssb:'||p_kind;p_max_body:=p.max_body_bytes;\n if p_max_body is null or p_max_body<1 or p_max_body>p.max_body_bytes then")
    base=once(base,'dispatch_response(p_reservation uuid)','dispatch_response(p_kind text,p_reservation uuid)')
    base=once(base,'settle_response(p_reservation uuid,p_outcome text,p_body_bytes integer,p_hash text)','settle_response(p_kind text,p_reservation uuid,p_outcome text,p_body_bytes integer,p_hash text)')
    base=once(base,' return terra_private.settle_source_response(p.run_id,r.request_fingerprint,w.claim_id,p_reservation,',""" if p_outcome='measured' and (p_hash is distinct from p.body_sha256 or p_body_bytes is distinct from p.body_bytes) then
  raise exception 'Measured paired fixture differs from trusted body' using errcode='42501';
 end if;
 return terra_private.settle_source_response(p.run_id,r.request_fingerprint,w.claim_id,p_reservation,""")
    # Revoke the actual revised signatures, including the internal helper.
    base=base.replace(f'{SCHEMA}.current_scope(),',f'{SCHEMA}.current_scope(text),')
    base=base.replace('reserve_response(text,integer)','reserve_response(text)')
    base=base.replace('dispatch_response(uuid)','dispatch_response(text,uuid)')
    base=base.replace('settle_response(uuid,text,integer,text)','settle_response(text,uuid,text,integer,text)')
    scope=(ROOT/'research/pending/TF009_fictional_response_commit_scope.sql').read_text().replace('terra_response_test_api',SCHEMA)
    scope=once(scope,f' p:={SCHEMA}.current_scope();',f" p:={SCHEMA}.current_scope((select response_kind from {SCHEMA}.principal_scopes where principal=session_user and registration_id=p_registration));")
    confirmation=(ROOT/'research/pending/TF009_fictional_response_confirmation.sql').read_text().replace('terra_response_test_api',SCHEMA)
    confirmation=once(confirmation,'confirm_response(p_phase text,p_receipt text)','confirm_response(p_kind text,p_phase text,p_receipt text)')
    confirmation=once(confirmation,f'p:={SCHEMA}.current_scope();',f'p:={SCHEMA}.current_scope(p_kind);')
    confirmation=confirmation.replace('confirm_response(text,text)','confirm_response(text,text,text)')
    guards=[]
    for filename,function,table,trigger,identity in (
      ('supabase/migrations/20261001104654_tf009_connected_capture_controls.sql','check_response_source_check','update_run_source_checks','response_source_check_commit_guard','new.run_id'),
      ('supabase/migrations/20261001104654_tf009_connected_capture_controls.sql','check_source_pair_run_binding','source_pair_run_bindings','response_pair_run_binding_commit','new.run_id'),
      ('supabase/migrations/20261001104654_tf009_connected_capture_controls.sql','require_response_pair_context_binding','source_response_pairs','response_pair_context_binding_commit','(select run_id from terra_private.source_pair_run_bindings where pair_id=new.id)'),
      ('supabase/migrations/20260930182359_tf009_source_checks_and_processing_completion.sql','check_run_closeout','update_run_closeouts','run_closeout_commit_guard','new.run_id')):
        original=(ROOT/filename).read_text()
        match=re.search(r'create function terra_private\.'+function+r'\(\).*?\$guard\$;',original,re.S)
        if not match or match.group().count('security invoker')!=1:raise ValueError('Pinned paired guard changed')
        guard=match.group().replace('terra_private.'+function+'()',SCHEMA+'.'+function+'()').replace('security invoker','security definer',1)
        guard=once(guard,'begin\n',f"""begin
 if session_user not in('postgres','supabase_admin') then
  declare authority {SCHEMA}.principal_scopes%rowtype;
  begin
   authority:={SCHEMA}.current_scope('metadata');
   if authority.run_id is distinct from {identity} then
    raise exception 'Pair COMMIT is outside authenticated run' using errcode='42501';
   end if;
  end;
 end if;
""")
        trigger_match=re.search(r'create constraint trigger '+trigger+r' after (insert(?: or update)?) on terra_private\.'+table+r'\b',original)
        if not trigger_match:raise ValueError('Pinned paired trigger event changed')
        guards.append(guard+f'\ndrop trigger {trigger} on terra_private.{table};\ncreate constraint trigger {trigger} after {trigger_match[1]} on terra_private.{table}\n deferrable initially deferred for each row execute function {SCHEMA}.{function}();\n')
    operations=(ROOT/'research/pending/TF009_fictional_ssb_pair_api_operations.sql').read_text()
    return '-- ISOLATED SSB-FORMAT FIXTURES ONLY. No primary/live collection or publication.\n'+base+'\n'+scope+'\n'+confirmation+'\n'+'\n'.join(guards)+'\n'+operations+f"""
revoke all on all functions in schema {SCHEMA} from public,anon,authenticated,service_role,
 terra_collector,terra_operator,terra_reviewer,terra_issue_reader;
"""

if __name__=='__main__':
    if sys.argv[1:]:raise RuntimeError('Fixed paired API composer accepts no arguments')
    print(build_fictional_ssb_pair_api(),end='')
