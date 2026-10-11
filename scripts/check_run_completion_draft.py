"""Fixed primary rollback casebook for candidate-28 or installed-29 schemas."""

from dataclasses import asdict, replace
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys

from scripts.check_local_db_target import main as check_target
from scripts.check_run_admission_draft import BASELINE, PRIMARY, query
from scripts.fictional_run_completion import CLOSE_SQL, fictional_completion_manifest, staged_completion_sql
from scripts.fictional_run_completion import completion_manifest_insert_sql, completion_source_check_insert_sql
from scripts.fictional_staged_machine_publication import ACTIVATE_SQL
from scripts.fictional_completion_manifest_cases import manifest_cases
from workers.update_run_completion import DecisionReceipt, PlannedItem, PlannedSource, reconcile_run_completion
from workers.update_run_closeout import parse_run_closeout


ROOT = Path(__file__).resolve().parents[1]
EXTRA_BASELINE = """select jsonb_build_object('manifest',to_regclass('terra_private.update_run_manifests'),
 'sourceChecks',to_regclass('terra_private.update_run_source_checks'),
 'closeout',to_regclass('terra_private.update_run_closeouts'),
 'summary',to_regprocedure('terra_private.summarize_run_processing(uuid)'));
"""


def expected_summary(plan, disposition):
    receipts = () if disposition is None else (DecisionReceipt(
        "88888888-8888-4888-8888-888888888888", plan.items[0].item_key, plan.items[0].source_version_id, disposition),)
    result = asdict(reconcile_run_completion(plan, receipts, (), (), now=datetime.now(timezone.utc)))
    camel = {re.sub(r"_([a-z])", lambda m: m[1].upper(), key): value for key, value in result.items()}
    return json.loads(json.dumps(camel))


def main() -> int:
    if sys.argv[1:] not in ([], ['--installed']):
        raise RuntimeError("This candidate accepts no connection, file or SQL arguments")
    installed = sys.argv[1:] == ['--installed']
    assert check_target([]) == 0
    container = PRIMARY[0]
    before = (json.loads(query(container, BASELINE)), json.loads(query(container, EXTRA_BASELINE)))
    assert before[0]["migrations"] == (29 if installed else 28)
    if installed:
        assert all(value is not None for value in before[1].values())
        from scripts.check_run_completion_copy import check_artifacts
        check_artifacts(ROOT)
    else:
        assert all(value is None for value in before[1].values())
    assert all(before[0][key] == 0 for key in ("runs", "versions", "decisions", "bindings", "publications", "heads"))
    overlay = '' if installed else (ROOT / "research/pending/TF009_run_completion.sql").read_text()
    outside = re.sub(r"--[^\n]*", "", overlay)
    outside = re.sub(r"(\$[A-Za-z_0-9]*\$)[\s\S]*?\1", "''", outside)
    assert not re.search(r"(?:^|;)\s*(?:begin|commit|rollback|abort|end|prepare\s+transaction)\b", outside, re.I | re.M)
    assert not re.search(r"^\s*\\", outside, re.M)
    plan = fictional_completion_manifest()
    cases = [("resolved-" + disposition, plan, disposition) for disposition in ("held", "rejected", "unchanged")]
    cases += [
        ("missing-decision", plan, None),
        ("eligible-without-activation", plan, "eligible"),
        ("checked-source-with-no-items", replace(plan, items=()), None),
        ("missing-capture", replace(plan, sources=(replace(plan.sources[0], source_version_id=None, content_sha256=None),), items=()), None),
        ("second-missing-item", replace(plan, items=plan.items + (PlannedItem("fictional-unprocessed", plan.sources[0].source_key,
             plan.sources[0].source_version_id),)), "held"),
    ]
    try:
        for name, candidate, disposition in cases:
            body = staged_completion_sql(manifest=candidate, disposition=disposition)
            sql = "begin;" + overlay + body + "create temporary table completion_result(response jsonb);"
            sql += "insert into completion_result " + CLOSE_SQL
            sql += """select jsonb_build_object('receipt',response,
              'expectedWorkClaimId',(select claim_id from terra_private.update_run_work_state),
              'expectedStartedAt',(select started_at from terra_private.update_run_work_state),
              'run',jsonb_build_object(
              'state',run_state,'commit',commit_state,'visibility',visibility_state,'finishedAt',finished_at))
              from completion_result,terra_private.update_runs;
              set constraints terra_private.run_closeout_commit_guard immediate; rollback;
            """
            result = json.loads(query(container, sql))
            summary = result["receipt"]["summary"]
            assert summary == expected_summary(candidate, disposition), name
            assert result["run"]["state"] == summary["runState"] and result["run"]["commit"] == summary["commitState"]
            assert result["run"]["visibility"] == summary["visibilityState"]
            assert result["run"]["finishedAt"] == result["receipt"]["finishedAt"]
            trusted = reconcile_run_completion(candidate, () if disposition is None else (DecisionReceipt(
                "88888888-8888-4888-8888-888888888888", candidate.items[0].item_key,
                candidate.items[0].source_version_id, disposition),), (), (), now=datetime.now(timezone.utc))
            parsed = parse_run_closeout(json.dumps(result["receipt"]).encode(), candidate,
                result["expectedWorkClaimId"], trusted,
                started_at=datetime.fromisoformat(result["expectedStartedAt"]), now=datetime.now(timezone.utc))
            assert parsed.status == "closed" and parsed.summary == trusted
            print(f"PASS {name}: exact Python/SQL processing agreement; rollback complete.")
        sql = "begin;" + overlay + staged_completion_sql(disposition="unchanged", historical_version=True) + CLOSE_SQL
        sql += "set constraints terra_private.run_closeout_commit_guard immediate;"
        sql += "select jsonb_build_object('versions',(select count(*) from terra_private.source_versions),'checks',(select count(*) from terra_private.update_run_source_checks)); rollback;"
        historic = [json.loads(line) for line in query(container, sql).splitlines()]
        assert historic[0]["summary"] == expected_summary(plan, "unchanged")
        assert historic[1] == {"versions": 1, "checks": 1}
        print("PASS fresh unchanged check: confirms the same historical version without duplicating source content.")
        for name, kwargs in [
            ("historical-version-called-new-capture", {"historical_version": True, "source_check_outcome": "captured"}),
            ("old-version-without-fresh-source-check", {"historical_version": True, "include_source_check": False}),
            ("fresh-version-without-source-check", {"include_source_check": False}),
        ]:
            try:
                query(container, "begin;" + overlay + staged_completion_sql(disposition="unchanged", **kwargs) + "rollback;")
            except RuntimeError as exc:
                assert "Source check does not match the current captured content" in str(exc) or \
                       "Manifest source receipt is not bound to this capture" in str(exc), name
            else:
                raise AssertionError(name)
            print(f"PASS {name}: stale coverage claim denied; rollback complete.")
        for isolation in ("repeatable read", "serializable"):
            for capture in (True, False):
                try:
                    query(container, "begin isolation level " + isolation + ";" + overlay + staged_completion_sql(
                        disposition=None, include_source_check=capture) + "rollback;")
                except RuntimeError as exc:
                    assert "Processing writes require read committed isolation" in str(exc)
                else:
                    raise AssertionError("A fixed snapshot must not write processing records")
                print(f"PASS {isolation} {'source check' if capture else 'manifest'}: stale-snapshot writes refused; rollback complete.")
        # Existing deferred activation checks require the run to remain open
        # until that transaction commits. Closing it in the same transaction
        # must fail rather than turn an in-transaction result into a receipt.
        sql = "begin;" + overlay + staged_completion_sql() + ACTIVATE_SQL + CLOSE_SQL
        sql += "set constraints terra_private.machine_publication_activation_commit_guard immediate; rollback;"
        try:
            query(container, sql)
        except RuntimeError as exc:
            assert "Work lease is not current" in str(exc)
        else:
            raise AssertionError("An uncommitted activation must not be closed")
        print("PASS activation/closeout in one transaction refuses; existing deferred activation authority preserved.")
        validator = """create function pg_temp.manifest_accepted(p text) returns boolean language plpgsql as $test$
          begin perform terra_private.validate_run_manifest(p); return true;
          exception when check_violation then return false; end; $test$;
        """
        values = ",".join("('" + name.replace("'", "''") + "','" + raw.replace("'", "''") + "'," +
            ("true" if accepted else "false") + ")" for name, raw, accepted in manifest_cases())
        sql = "begin;" + overlay + validator + "select jsonb_agg(jsonb_build_object('name',name,'matched',"
        sql += "pg_temp.manifest_accepted(raw)=expected)) from (values " + values + ") cases(name,raw,expected); rollback;"
        validated = json.loads(query(container, sql))
        assert len(validated) == len(manifest_cases()) and all(entry["matched"] for entry in validated), validated
        print(f"PASS {len(validated)} canonical-manifest cases: closed keys, exact ASCII bytes, duplicates, null capture and limits.")

        closure = CLOSE_SQL.rstrip().removesuffix(";")
        helper = """create function pg_temp.try_completion_statement(stmt text) returns jsonb language plpgsql as $test$
          begin execute stmt; return jsonb_build_object('status','unexpected_success');
          exception when check_violation then return jsonb_build_object('status','held'); end; $test$;
        """
        source_insert = completion_source_check_insert_sql(plan).strip().removesuffix(";")
        byte_marker = "'captured'," + str(len((ROOT/'fixtures/fictional_structured_source.json').read_bytes())) + ","
        assert source_insert.count(byte_marker) == 1
        capture_prefix = staged_completion_sql(disposition=None)
        for statement in (completion_source_check_insert_sql(plan), completion_manifest_insert_sql(plan)):
            assert capture_prefix.count(statement) == 1
            capture_prefix = capture_prefix.replace(statement, "")
        source_cases = [
            ("source-key-substitution", "", source_insert.replace("payload->>'sourceKey'", "'fictional-substitute'")),
            ("source-hash-mismatch", "", source_insert.replace("'" + plan.sources[0].content_sha256 + "'", "repeat('a',64)")),
            ("foreign-source-work-holder", "", source_insert.replace("(response->>'leaseId')::uuid", "'66666666-6666-4666-8666-666666666666'::uuid")),
            ("fetch-disabled-at-source-check", "update terra_private.source_registrations set fetch_enabled=false;", source_insert),
            ("recorded-bytes-exceed-run-cap", "", source_insert.replace(byte_marker, "'captured',2000001,")),
            ("negative-recorded-bytes", "", source_insert.replace(byte_marker, "'captured',-1,")),
            ("failed-check-cannot-claim-a-version", "", source_insert.replace("'captured'", "'failed'")),
            ("future-source-check", "", source_insert.replace("total_response_bytes,work_claim_id)", "total_response_bytes,work_claim_id,checked_at)").replace(
                "(response->>'leaseId')::uuid", "(response->>'leaseId')::uuid,clock_timestamp()+interval '1 minute'")),
            ("source-check-before-current-claim", "", source_insert.replace("total_response_bytes,work_claim_id)", "total_response_bytes,work_claim_id,checked_at)").replace(
                "(response->>'leaseId')::uuid", "(response->>'leaseId')::uuid,'2026-09-28T06:00:00Z'::timestamptz")),
            ("source-check-after-fixed-manifest", "", source_insert),
        ]
        for name, mutation, attempted in source_cases:
            seed = staged_completion_sql(disposition=None) if name == "source-check-after-fixed-manifest" else capture_prefix
            sql = "begin;" + overlay + seed + helper + mutation
            sql += "select pg_temp.try_completion_statement('" + attempted.replace("'", "''") + "'); rollback;"
            assert json.loads(query(container, sql)) == {"status": "held"}, name
            print(f"PASS {name}: source-check binding/time/recorded-byte boundary holds; rollback complete.")
        direct = """insert into terra_private.update_run_closeouts(run_id,work_claim_id,manifest_sha256,summary,finished_at)
          select run_id,work_claim_id,manifest_sha256,%SUMMARY%,%FINISH% from terra_private.update_run_manifests"""
        plain_summary = "terra_private.summarize_run_processing(run_id)"
        mutations = [
            ("wrong-request-fingerprint", "", closure.replace("payload->>'requestFingerprint'", "repeat('a',64)")),
            ("wrong-manifest-fingerprint", "", closure.replace("(select manifest_sha256 from terra_private.update_run_manifests where run_id=(payload->>'runId')::uuid)", "repeat('a',64)")),
            ("foreign-work-claim", "", closure.replace("(response->>'leaseId')::uuid", "'66666666-6666-4666-8666-666666666666'::uuid")),
            ("forged-completion-count", "", direct.replace("%SUMMARY%", "jsonb_set(" + plain_summary + ",'{decidedItems}','2')").replace("%FINISH%", "clock_timestamp()")),
            ("forged-public-visibility", "", direct.replace("%SUMMARY%", "jsonb_set(" + plain_summary + ",'{visibilityState}','\"verified\"')").replace("%FINISH%", "clock_timestamp()")),
            ("future-finish", "", direct.replace("%SUMMARY%", plain_summary).replace("%FINISH%", "clock_timestamp()+interval '1 minute'")),
            ("finish-before-capture", "", direct.replace("%SUMMARY%", plain_summary).replace("%FINISH%", "captured_at-interval '1 second'")),
            ("finish-without-receipt", "", "update terra_private.update_runs set run_state='completed',finished_at=clock_timestamp()"),
            ("manifest-after-decisions", "", "insert into terra_private.update_run_manifests select * from terra_private.update_run_manifests"),
            ("orphan-receipt-at-transaction-end", "", direct.replace("%SUMMARY%", plain_summary).replace("%FINISH%", "clock_timestamp()") + "; set constraints terra_private.run_closeout_commit_guard immediate"),
        ]
        for name, mutation, attempted in mutations:
            sql = "begin;" + overlay + staged_completion_sql(disposition="held") + helper + mutation
            sql += "select pg_temp.try_completion_statement('" + attempted.replace("'", "''") + "'); rollback;"
            assert json.loads(query(container, sql)) == {"status": "held"}, name
            print(f"PASS {name}: denied without a receipt or final-state change; rollback complete.")
        for name, mutation in [
            ("source-hash-changed-after-plan", "update terra_private.source_versions set content_sha256=repeat('a',64);"),
            ("registration-key-substituted", "update terra_private.source_registrations set source_key='fictional-substitute';"),
        ]:
            sql = "begin;" + overlay + staged_completion_sql(disposition="held") + mutation + CLOSE_SQL
            sql += "set constraints terra_private.run_closeout_commit_guard immediate; rollback;"
            response = json.loads(query(container, sql))
            pure = reconcile_run_completion(plan, (DecisionReceipt("88888888-8888-4888-8888-888888888888",
                plan.items[0].item_key, plan.items[0].source_version_id, "held"),), (), (), now=datetime.now(timezone.utc),
                invalid_source_keys=(plan.sources[0].source_key,))
            from workers.update_run_closeout import completion_summary_payload
            assert response["summary"] == completion_summary_payload(pure), name
            assert response["summary"]["runState"] == "partial" and response["summary"]["coveredSourceKeys"] == []
            print(f"PASS {name}: invalid receipt remains explicit; run closes partial rather than concealing failure.")
        # Closing near the deadline must be checked again after wall-clock
        # time passes, not merely when the receipt's INSERT first succeeds.
        delayed = """create function pg_temp.delayed_closeout() returns jsonb language plpgsql as $test$
          begin %CLOSE%; perform pg_sleep(1.1); set constraints terra_private.run_closeout_commit_guard immediate;
            return jsonb_build_object('status','unexpected_success');
          exception when check_violation then return jsonb_build_object('status','held'); end; $test$;
        """.replace("%CLOSE%", "perform terra_private.close_update_run_processing((payload->>'runId')::uuid,"
          "payload->>'requestFingerprint',(response->>'leaseId')::uuid,(select manifest_sha256 from terra_private.update_run_manifests)) "
          "from activation_input,owned_work_claim")
        sql = "begin;" + overlay + staged_completion_sql(duration=1, disposition="held") + delayed
        sql += "select jsonb_build_object('result',pg_temp.delayed_closeout());"
        sql += "select jsonb_build_object('closeouts',(select count(*) from terra_private.update_run_closeouts),'runState',(select run_state from terra_private.update_runs)); rollback;"
        delayed_results = [json.loads(line) for line in query(container, sql).splitlines()]
        assert delayed_results == [{"result": {"status": "held"}}, {"closeouts": 0, "runState": "running"}]
        print("PASS deadline-expires-before-closeout-commit: receipt and finished state rolled back together.")
        fixture = (ROOT / "research/pending/TF009_run_completion.test.sql").read_text()
        for marker in ("-- TF_RUN_COMPLETION_OVERLAY", "-- TF_RUN_COMPLETION_STAGE", "-- TF_RUN_COMPLETION_CLOSE"):
            assert fixture.count(marker) == 1
        fixture = fixture.replace("-- TF_RUN_COMPLETION_OVERLAY", overlay)
        fixture = fixture.replace("-- TF_RUN_COMPLETION_STAGE", staged_completion_sql(disposition="held"))
        fixture = fixture.replace("-- TF_RUN_COMPLETION_CLOSE", "insert into checked_closeout " + CLOSE_SQL)
        tap = query(container, fixture)
        passed = len(re.findall(r"^ok \d+\b", tap, re.M))
        result_plan = re.search(r"^1\.\.(\d+)$", tap, re.M)
        assert result_plan and int(result_plan.group(1)) == passed and passed >= 80, tap
        assert not re.search(r"^not ok|^# (?:Looks like|Failed)", tap, re.M), tap
        print(f"PASS {passed} pgTAP checks: exact private shape, RLS, invoker/ACL boundary, immutable processing evidence.")
    finally:
        after = (json.loads(query(container, BASELINE)), json.loads(query(container, EXTRA_BASELINE)))
        assert before == after, "All candidate objects and fictional rows must be restored"
    print(f"PASS {len(cases) + 1 + len(mutations) + len(source_cases) + 11} closeout/source-check cases; primary remains unchanged at {before[0]['migrations']} migrations.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
