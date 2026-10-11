"""Fixed owner-only activation casebook with complete primary rollback."""

from pathlib import Path
import json
import re
import subprocess
import sys

from scripts.check_local_db_target import main as check_target
from scripts.check_run_admission_draft import BASELINE,PRIMARY,query
from scripts.fictional_staged_machine_publication import staged_machine_publication_sql
from scripts.fictional_staged_machine_publication import ACTIVATE_SQL


ROOT=Path(__file__).resolve().parents[1]
EXTRA_BASELINE="""select jsonb_build_object(
 'activations',to_regclass('terra_private.machine_publication_activations'),
 'work',to_regclass('terra_private.update_run_work_state'),
 'activate',to_regprocedure('terra_private.activate_machine_publication(uuid,uuid,uuid,text,uuid,text)'));
"""
HELPER="""create function pg_temp.try_activation(h uuid default null,f text default null,
 l uuid default null,s text default null) returns jsonb language plpgsql as $try$
declare p jsonb; w jsonb; sha text;
begin
 select payload into p from activation_input;
 select response into w from owned_work_claim;
 select publication_sha256 into sha from expected_activation_identity;
 return terra_private.activate_machine_publication((p #>> '{draft,publication,id}')::uuid,
   '88888888-8888-4888-8888-888888888888',h,coalesce(f,p->>'requestFingerprint'),
   coalesce(l,(w->>'leaseId')::uuid),coalesce(s,sha));
exception when check_violation or unique_violation or foreign_key_violation then
 return jsonb_build_object('status','held','reason',sqlerrm);
end;
$try$;
"""


def validate_result(result: dict,expected: dict) -> dict:
    response=subprocess.run(["node","--experimental-strip-types","scripts/check_machine_activation_result.mjs"],
       input=json.dumps({"result":result,"expected":expected}),capture_output=True,text=True,
       cwd=ROOT,timeout=15)
    assert response.returncode==0 and len(response.stdout)<128*1024,"Strict materializer rejected activation."
    return json.loads(response.stdout)


def rejected_reader_mutations(result: dict,expected: dict) -> int:
    mutations=[
      ("wrong-selected-decision",lambda p:p["candidate"]["citations"][0]["machine_binding"].update(
        decisionId="99999999-9999-4999-8999-999999999999")),
      ("missing-selected-binding",lambda p:p["candidate"]["citations"][0].update(machine_binding=None)),
      ("second-source",lambda p:p["candidate"]["sources"].append(p["candidate"]["sources"][0])),
      ("second-claim",lambda p:p["candidate"]["claims"].append(p["candidate"]["claims"][0])),
      ("second-citation",lambda p:p["candidate"]["citations"].append(p["candidate"]["citations"][0])),
      ("private-root",lambda p:p.update(privateOwnerField="fictional-placeholder")),
      ("private-candidate-root",lambda p:p["candidate"].update(privateOwnerField="fictional-placeholder")),
    ]
    for name,mutate in mutations:
        copy=json.loads(json.dumps(result)); mutate(copy)
        response=subprocess.run(["node","--experimental-strip-types","scripts/check_machine_activation_result.mjs"],
          input=json.dumps({"result":copy,"expected":expected}),capture_output=True,text=True,cwd=ROOT,timeout=15)
        assert response.returncode!=0 and response.stdout=="",name
    return len(mutations)


def main() -> int:
    installed=sys.argv[1:]==["--installed"]
    if sys.argv[1:] and not installed:
        raise RuntimeError("Only the fixed installed rollback mode is supported.")
    assert check_target([])==0
    container=PRIMARY[0]
    before=(json.loads(query(container,BASELINE)),json.loads(query(container,EXTRA_BASELINE)))
    assert before[0]["migrations"]==(28 if installed else 27)
    assert (before[0]["requests"] is not None)==installed
    assert all(before[0][key]==0 for key in ("runs","versions","decisions","bindings","publications","heads"))
    assert all((value is not None)==installed for value in before[1].values())
    overlay="" if installed else "\n".join((ROOT/"research/pending"/name).read_text() for name in
        ("TF009_run_admission.sql","TF009_run_work_lease.sql","TF009_machine_activation.sql"))
    outside=re.sub(r"--[^\n]*","",overlay)
    outside=re.sub(r"(\$[A-Za-z_0-9]*\$)[\s\S]*?\1","''",outside)
    assert not re.search(r"(?:^|;)\s*(?:begin|commit|rollback|abort|end|prepare\s+transaction)\b",outside,re.I|re.M)
    assert not re.search(r"^\s*\\",outside,re.M)
    seed=staged_machine_publication_sql()
    success="pg_temp.try_activation()"
    replay="do $replay$ begin perform pg_temp.try_activation(); end; $replay$;"
    cases=[
      ("current-qualified-condition","",success,"activated"),
      ("same-request-replay",replay,success,"already_activated"),
      ("replay-conflicting-fingerprint",replay,"pg_temp.try_activation(null,repeat('a',64))","held"),
      ("replay-conflicting-publication-hash",replay,"pg_temp.try_activation(null,null,null,repeat('a',64))","held"),
      ("foreign-work-holder","","pg_temp.try_activation(null,null,'66666666-6666-4666-8666-666666666666')","held"),
      ("stale-predecessor","","pg_temp.try_activation('66666666-6666-4666-8666-666666666666')","held"),
      ("source-rights-withdrawn","update terra_private.source_registrations set allow_public_derived=false;",success,"held"),
      ("fetch-disabled","update terra_private.source_registrations set fetch_enabled=false;",success,"held"),
      ("source-hash-changed","update terra_private.source_versions set content_sha256=repeat('a',64);",success,"held"),
      ("selected-citation-missing","delete from terra_private.issue_publication_citations;",success,"held"),
      ("publication-mutated-after-check","update terra_private.issue_publications set snapshot=jsonb_set(snapshot,'{summary}','\"Fictional substituted summary\"');",success,"held"),
      ("condition-row-mutated","update terra_private.claims set assertion='Fictional substituted assertion';",success,"held"),
      ("source-title-withdrawn","insert into terra_private.source_display_reviews(source_version_id,revision,decision,reviewed_at,review_reference) select source_version_id,2,'withdrawn',transaction_timestamp(),'fictional-withdrawal' from terra_private.source_display_reviews;",success,"held"),
      ("issue-text-withdrawn","insert into terra_private.issue_text_reviews(publication_id,revision,decision,reviewed_at,review_reference) select publication_id,2,'withdrawn',transaction_timestamp(),'fictional-withdrawal' from terra_private.issue_text_reviews;",success,"held"),
      ("period-review-withdrawn","insert into terra_private.claim_period_reviews(publication_id,claim_id,revision,decision,reviewed_at,review_reference) select publication_id,claim_id,2,'withdrawn',transaction_timestamp(),'fictional-withdrawal' from terra_private.claim_period_reviews;",success,"held"),
      ("assertion-review-withdrawn","insert into terra_private.claim_assertion_reviews(publication_id,claim_id,revision,decision,reviewed_at,review_reference) select publication_id,claim_id,2,'withdrawn',transaction_timestamp(),'fictional-withdrawal' from terra_private.claim_assertion_reviews;",success,"held"),
      ("qualification-suspended","insert into terra_private.automatic_route_qualifications(registration_id,change_class,revision,decision,exact_endpoint,policy_version,parser_version,decision_reference,decided_by,decided_at) select registration_id,change_class,2,'suspended',exact_endpoint,policy_version,parser_version,'fictional-suspension','fictional-owner',transaction_timestamp() from terra_private.automatic_route_qualifications;",success,"held"),
      ("newer-source-receipt","insert into terra_private.source_versions(registration_id,item_key,source_url,retrieved_at,content_sha256) select registration_id,item_key,source_url,transaction_timestamp(),repeat('b',64) from terra_private.source_versions;",success,"held"),
      ("run-finished-before-activation","update terra_private.update_runs set run_state='completed',finished_at=transaction_timestamp();",success,"held"),
      ("late-receipt-failure","create function pg_temp.inject_activation_failure() returns trigger language plpgsql as $failure$ begin raise exception 'Fictional late activation failure' using errcode='23514'; end; $failure$;create trigger fictional_activation_failure before insert on terra_private.machine_publication_activations for each row execute function pg_temp.inject_activation_failure();",success,"held"),
    ]
    tail="""select jsonb_build_object('result',case_result.response,'expected',jsonb_build_object(
 'publicationId',payload #>> '{draft,publication,id}',
 'decisionId','88888888-8888-4888-8888-888888888888','runId',payload->>'runId',
 'requestFingerprint',payload->>'requestFingerprint','publicationSha256',publication_sha256),
 'bindings',(select count(*) from terra_private.issue_publication_machine_bindings),
 'activations',(select count(*) from terra_private.machine_publication_activations),
 'activeHeads',(select count(*) from terra_private.issue_heads where current_publication_id is not null),
 'commitState',(select commit_state from terra_private.update_runs limit 1),
 'runState',(select run_state from terra_private.update_runs limit 1))
 from case_result,activation_input,expected_activation_identity;
set constraints terra_private.machine_publication_activation_commit_guard immediate;
rollback;
"""
    try:
        for name,mutation,call,expected_status in cases:
            sql="begin;"+overlay+seed+HELPER+mutation+"\ncreate temporary table case_result(response jsonb);"
            sql+="insert into case_result select "+call+";\n"+tail
            observed=json.loads(query(container,sql))
            assert observed["result"]["status"]==expected_status,name
            if expected_status!="held":
                checked=validate_result(observed["result"],observed["expected"])
                assert checked["visibilityState"]=="pending"
                assert observed["bindings"]==observed["activations"]==observed["activeHeads"]==1
                assert observed["commitState"]=="partial" and observed["runState"]=="running"
                if expected_status=="activated":
                    assert checked["issue"]["claims"][0]["assertion"]=="In 2025, the fictional share was 27.4%."
                    assert checked["issue"]["claims"][0]["evidence"][0]["url"]=="https://example.org/fictional-table"
                    assert rejected_reader_mutations(observed["result"],observed["expected"])==7
            elif not name.startswith("replay-"):
                assert observed["bindings"]==observed["activations"]==observed["activeHeads"]==0,name
                assert observed["commitState"]=="none",name
            print(f"PASS {name}: {expected_status}; rollback complete.")
        delayed="""create function pg_temp.delayed_activation(wait_seconds double precision,
             revoke_rights boolean default false) returns jsonb language plpgsql as $delay$
          declare response jsonb; begin
            response:=pg_temp.try_activation();
            if response->>'status'<>'activated' then return response; end if;
            if revoke_rights then update terra_private.source_registrations set allow_public_derived=false; end if;
            perform pg_sleep(wait_seconds);
            set constraints terra_private.machine_publication_activation_commit_guard immediate;
            return response;
          exception when check_violation then
            return jsonb_build_object('status','held','reason',sqlerrm);
          end; $delay$;
        """
        for name,special_seed,delay,withdraw,reason in [
          ("qualification-expires-before-commit",staged_machine_publication_sql(
              expiry_sql="clock_timestamp()+interval '1 second'"),1.1,False,
              "Activation authority or receipt is not current"),
          ("work-deadline-expires-before-commit",staged_machine_publication_sql(duration=1),1.1,False,
              "Work lease is not current"),
          ("rights-change-before-commit",seed,0,True,"Activation authority or receipt is not current"),
        ]:
            sql="begin;"+overlay+special_seed+HELPER+delayed+"create temporary table case_result(response jsonb);"
            sql+=f"insert into case_result select pg_temp.delayed_activation({delay},{'true' if withdraw else 'false'});"+tail
            observed=json.loads(query(container,sql))
            assert observed["result"]=={"status":"held","reason":reason},name
            assert observed["bindings"]==observed["activations"]==observed["activeHeads"]==0,name
            assert observed["commitState"]=="none" and observed["runState"]=="running",name
            print(f"PASS {name}: final-transaction guard holds and restores head/binding/receipt.")
        tap_fixture=(ROOT/"research/pending/TF009_machine_activation.test.sql").read_text()
        assert tap_fixture.count("-- TF_ACTIVATION_CONTROL_OVERLAY")==1
        assert tap_fixture.count("-- TF_ACTIVATION_CONTROL_STAGE")==1
        assert tap_fixture.count("-- TF_ACTIVATION_CONTROL_CALL")==1
        tap_fixture=tap_fixture.replace("-- TF_ACTIVATION_CONTROL_OVERLAY",overlay)
        tap_fixture=tap_fixture.replace("-- TF_ACTIVATION_CONTROL_STAGE",seed)
        tap_fixture=tap_fixture.replace("-- TF_ACTIVATION_CONTROL_CALL",
             "insert into checked_activation "+ACTIVATE_SQL)
        tap=query(container,tap_fixture)
        passed=len(re.findall(r"^ok \d+\b",tap,re.M))
        plan=re.search(r"^1\.\.(\d+)$",tap,re.M)
        assert plan and int(plan.group(1))==passed and passed>=25,tap
        assert not re.search(r"^not ok|^# (?:Looks like|Failed)",tap,re.M),tap
        print(f"PASS {passed} pgTAP activation ACL, immutable receipt/publication, UTC hash and final-guard checks.")
    finally:
        after=(json.loads(query(container,BASELINE)),json.loads(query(container,EXTRA_BASELINE)))
        assert before==after,"Draft schema, rows and reader authority must be restored."
    print(f"PASS {len(cases)+3} activation/strict-reader cases plus seven mutated reader responses; primary remains unchanged at {before[0]['migrations']} migrations.")
    return 0


if __name__=="__main__":
    raise SystemExit(main())
