"""Fixed rollback-only chronology validation: historical draft 26 or authorized active 27."""

from __future__ import annotations

import json
from pathlib import Path
import re
import subprocess
import sys

from scripts.fictional_activation_payload import fictional_activation_payload


ROOT = Path(__file__).resolve().parents[1]
CONTAINER = "supabase_db_terrafracta-local"
ARGS = ["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres",
        "-X", "-qAt", "-v", "ON_ERROR_STOP=1"]


def query(sql: str) -> str:
    result = subprocess.run(ARGS, input=sql, capture_output=True, text=True, timeout=30)
    if result.returncode or len(result.stdout) > 256 * 1024:
        raise RuntimeError("Fixed rollback timeline rehearsal failed; no permanent change applied.")
    return result.stdout.strip()


BASELINE = """select jsonb_build_object(
 'migrations',(select count(*) from supabase_migrations.schema_migrations),
 'versions',(select count(*) from terra_private.source_versions),
 'qualifications',(select count(*) from terra_private.automatic_route_qualifications),
 'decisions',(select count(*) from terra_private.machine_candidate_decisions),
 'bindings',(select count(*) from terra_private.issue_publication_machine_bindings),
 'publications',(select count(*) from terra_private.issue_publications),
 'heads',(select count(*) from terra_private.issue_heads),
 'reader_member',pg_has_role('postgres','terra_issue_reader','MEMBER'),
 'draft_guard',to_regprocedure('terra_private.check_machine_qualification_timeline_insert()') is not null,
 'enabled_timeline_triggers',(select count(*) from pg_trigger where tgname in
 ('machine_qualification_timeline_insert_guard','publication_qualification_timeline_insert_guard') and tgenabled='O'));
"""


def main() -> int:
    active = sys.argv[1:] == ["--active"]
    if sys.argv[1:] and not active:
        raise RuntimeError("Only the fixed authorized active mode is supported.")
    inspected = subprocess.run(["docker", "inspect", "--format", "{{json .NetworkSettings.Ports}}",
                               CONTAINER], capture_output=True, text=True, check=True, timeout=10)
    assert json.loads(inspected.stdout)["5432/tcp"] == [{"HostIp": "127.0.0.1", "HostPort": "65432"}]
    before = json.loads(query(BASELINE))
    assert before["migrations"] == (27 if active else 26)
    assert before["draft_guard"] is active
    assert before["enabled_timeline_triggers"] == (2 if active else 0)
    overlay = (ROOT / "research/pending/TF009_qualification_timeline.sql").read_text()
    outside = re.sub(r"--[^\n]*", "", overlay)
    outside = re.sub(r"(\$[A-Za-z_0-9]*\$)[\s\S]*?\1", "''", outside)
    assert not re.search(r"(?:^|;)\s*(?:begin|commit|rollback|abort|end|prepare\s+transaction)\b", outside, re.I | re.M)
    assert not re.search(r"^\s*\\", outside, re.M)
    payload = fictional_activation_payload(distinct_public_target=True)
    seed = (ROOT / "tests/fixtures/tf009_machine_activation_bridge.sql").read_text()
    seed = seed.replace("-- TF_ACTIVATION_INPUT", "insert into activation_input values ('"+
                        json.dumps(payload).replace("'", "''")+"'::jsonb);")
    seed = seed.replace("or evidence->>'url' is distinct from v.source_url", "")
    seed = seed.replace("-- TF_MACHINE_BINDING_INSERT", """insert into
      terra_private.issue_publication_machine_bindings (publication_id,claim_id,decision_id)
      values (pub_id,fixture_claim_id,d.id);""")
    if active:
        # Only the local owner can stage legacy inconsistent assertions. Disable
        # this one new guard during fixed test seeding, then restore it before
        # any activation/negative check. Both ALTERs remain inside BEGIN/ROLLBACK.
        seed = seed.replace("begin;", "begin;\nalter table terra_private.machine_candidate_decisions disable trigger machine_qualification_timeline_insert_guard;", 1)
        seed += "\nalter table terra_private.machine_candidate_decisions enable trigger machine_qualification_timeline_insert_guard;\n"
    scenarios = [
        ("current-ordered-qualification", seed, True, "activated"),
        ("future-qualification-diagnosis", seed.replace("'2026-09-28T05:30:00Z'::timestamptz",
             "transaction_timestamp()+interval '1 day'"), False, "held" if active else "activated"),
        ("future-qualification-draft-refusal", seed.replace("'2026-09-28T05:30:00Z'::timestamptz",
             "transaction_timestamp()+interval '1 day'"), True, "held"),
        ("decision-before-qualification", seed.replace("'2026-09-28T05:30:00Z'::timestamptz",
             "'2026-09-28T06:01:30Z'::timestamptz"), True, "held"),
        ("infinite-qualification-time", seed.replace("'2026-09-28T05:30:00Z'::timestamptz",
             "'infinity'::timestamptz"), True, "held"),
    ]
    try:
        for label, fixture, use_draft, expected in scenarios:
            result = json.loads(query(fixture + (overlay if use_draft and not active else "") +
                "\nselect pg_temp.try_fictional_activation(payload) from activation_input;\nrollback;"))
            assert result["status"] == expected, label
            if expected == "held":
                assert result["reason"] == "Publication qualification timeline is invalid", label
            print(f"PASS {label}: {expected}; rollback complete.")
        # These decisions are created after the draft overlay, unlike the
        # deliberately legacy decisions used above to exercise binding defense.
        sql = seed + ("" if active else overlay) + """
create extension if not exists pgtap with schema extensions;
select plan(4);
select throws_ok($test$insert into terra_private.machine_candidate_decisions
 (run_id,qualification_id,source_version_id,candidate_key,disposition,content_sha256,
  evidence_locator,semantic_contract_sha256,check_trace,reason_codes,machine_actor,
  decided_at,public_citation_url)
 select run_id,qualification_id,source_version_id,'future-decision','eligible',content_sha256,
  evidence_locator,semantic_contract_sha256,check_trace,reason_codes,machine_actor,
  transaction_timestamp()+interval '1 day',public_citation_url
 from terra_private.machine_candidate_decisions$test$,
 '23514','Machine qualification timeline is invalid','future eligible decision is refused');
select ok(not has_function_privilege('terra_issue_reader',
 'terra_private.check_machine_qualification_timeline_insert()','EXECUTE'),'reader cannot invoke decision helper');
select ok(not has_function_privilege('terra_issue_reader',
 'terra_private.check_publication_qualification_timeline_insert()','EXECUTE'),'reader cannot invoke binding helper');
select ok(not has_function_privilege('anon',
 'terra_private.check_publication_qualification_timeline_insert()','EXECUTE'),'anonymous helper access refused');
select * from finish();
rollback;
"""
        tap = query(sql)
        assert re.search(r"^1\.\.4$", tap, re.M)
        assert len(re.findall(r"^ok \d+\b", tap, re.M)) == 4
        assert not re.search(r"^not ok|^# (?:Looks like|Failed)", tap, re.M)
        print("PASS 4 pgTAP eligible-time/function-denial checks; rollback complete.")
    finally:
        assert json.loads(query(BASELINE)) == before, "All rows, membership and overlay must be restored."
    print(f"{'Authorized active' if active else 'Draft only'}: five fixed scenarios and four pgTAP checks; baseline {before['migrations']} unchanged.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
