-- UNINSTALLED owner-only invented outer work fence. No new writer or lease.
-- The manual7 association and original generic6/work8 functions stay unchanged.
-- This is a function-end fence, not authority through an arbitrarily late COMMIT.
create function tf_appended_review.capture_issue_for_work(p_run uuid,p_fingerprint text,p_claim uuid,
 p_intent bytea,p_report bytea,p_base bytea,p_canonical bytea,p_context bytea,p_proposal bytea,p_composition bytea)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare intent jsonb;receipt jsonb;
begin
 if current_user<>'postgres' then raise exception using errcode='42501',message='invented_appended_work_owner_required';end if;
 if current_setting('transaction_read_only')='on' then raise exception using errcode='25006',message='invented_appended_work_writer_required';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception using errcode='25001',message='invented_appended_work_isolation_required';end if;
 if p_run is null or p_intent is null or octet_length(p_intent) not between 1 and 4096 then
  raise exception using errcode='22023',message='invented_appended_work_scope_invalid';end if;
 intent:=convert_from(p_intent,'UTF8')::jsonb;
 if jsonb_typeof(intent) is distinct from 'object' or jsonb_typeof(intent->'run_id') is distinct from 'string' or intent->>'run_id' is distinct from p_run::text then
  raise exception using errcode='22023',message='invented_appended_work_scope_invalid';end if;
 perform terra_private.assert_update_run_work(p_run,p_fingerprint,p_claim);
 receipt:=tf_appended_review.capture_issue(p_intent,p_report,p_base,p_canonical,p_context,p_proposal,p_composition);
 -- Covers the complete association-table lock, real capture, new provenance
 -- insertion and actual full receipt limit; a late failure rolls back both rows.
 perform terra_private.assert_update_run_work(p_run,p_fingerprint,p_claim);
 return receipt;
end
$$;
revoke all on function tf_appended_review.capture_issue_for_work(uuid,text,uuid,bytea,bytea,bytea,bytea,bytea,bytea,bytea) from public;
