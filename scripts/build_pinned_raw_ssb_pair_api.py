"""Exact source identity at the isolated native capture permission boundary.

Reuses the closed unknown/raw candidate. Only the trusted test custodian seeds
the inventory pin. This is not a primary migration, live account or permission;
the namespace, actor, source context and actual replies remain fictional.
"""
from scripts.build_raw_unknown_ssb_pair_api import build_raw_unknown_ssb_pair_api
from scripts.build_fictional_ssb_pair_api import once, SCHEMA


def build_pinned_raw_ssb_pair_api():
    sql = build_raw_unknown_ssb_pair_api()
    sql = once(sql, ' retain_raw boolean not null default false,',
        " retain_raw boolean not null default false,\n source_inventory_sha256 text not null check(source_inventory_sha256~'^[0-9a-f]{64}$'),")
    marker = "  or r.mode<>'shadow' or s.source_key is distinct from ('ssb-14059-'||p_kind)"
    sql = once(sql, marker, """  or r.code_version is distinct from ('ssb-sha256:'||p.source_inventory_sha256)
  or (select canonical_request::jsonb->>'trigger' from terra_private.update_run_requests where run_id=r.id) is distinct from 'manual'
  or (select canonical_request::jsonb->'scheduled_due_at' from terra_private.update_run_requests where run_id=r.id) is distinct from 'null'::jsonb
  or (r.limits->>'max_retries')::integer is distinct from 0
  or (r.limits->>'max_model_calls')::integer is distinct from 0
  or (r.limits->>'max_items')::integer is distinct from 3
  or (r.limits->>'max_response_bytes')::integer is distinct from 131074
  or (select attempt_no from terra_private.update_run_work_claims where id=p.work_claim_id) is distinct from 1
"""+marker)
    # Both response contexts must carry the same separately seeded source pin;
    # checking only one context would allow a half-bound dispatch after drift.
    marker = ' select * into r from terra_private.update_runs where id=p.run_id;\n select * into s from terra_private.source_registrations where id=p.registration_id;'
    sql = once(sql, marker, f""" if (select count(*) from {SCHEMA}.principal_scopes where principal=session_user)<>2
  or exists(select 1 from {SCHEMA}.principal_scopes peer where peer.principal=session_user
   and (peer.source_inventory_sha256 is distinct from p.source_inventory_sha256
        or peer.run_id is distinct from p.run_id or peer.work_claim_id is distinct from p.work_claim_id
        or peer.pair_id is distinct from p.pair_id or not peer.enabled or not peer.retain_raw
        or clock_timestamp()>=peer.expires_at)) then
  raise exception 'Paired source identity is not fully bound' using errcode='42501';
 end if;
"""+marker)
    return '-- ISOLATED EXACT-SOURCE RAW API CANDIDATE. No live/primary grant.\n'+sql
