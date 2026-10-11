"""One-shot invented successor on the fixed retained isolated checkpoint.

First checks/rolls back the complete proposal, then commits a checked revision.
Preserves the original publication and shows old-receipt replay cannot restore
it. No primary, external endpoint, schedule, application writer or reset.
"""

import json
import sys

from scripts.check_machine_activation_commit import ARGS,CONTAINER,NETWORK,PORT,STATE,query
from scripts.check_machine_activation_concurrency import Session
from scripts.check_machine_activation_draft import validate_result
from scripts.check_run_admission_concurrency import quote
from scripts.fictional_successor_stage_sql import (
    FIRST_PUBLICATION,SECOND_DECISION,successor_stage_sql,
)


META="""select jsonb_build_object('expected',jsonb_build_object(
 'publicationId',payload #>> '{draft,publication,id}','decisionId','%DECISION%',
 'runId',payload->>'runId','requestFingerprint',payload->>'requestFingerprint',
 'publicationSha256',publication_sha256),'leaseId',response->>'leaseId')
 from activation_input,expected_activation_identity,owned_work_claim;
""".replace("%DECISION%",SECOND_DECISION)


def activation_call(meta: dict,head: str|None) -> str:
    expected=meta["expected"]
    return "select terra_private.activate_machine_publication("+",".join([
        quote(expected["publicationId"]),quote(expected["decisionId"]),
        "null" if head is None else quote(head),quote(expected["requestFingerprint"]),
        quote(meta["leaseId"]),quote(expected["publicationSha256"])])+ ");"


def main() -> int:
    import subprocess
    if sys.argv[1:]:
        raise RuntimeError("Fixed successor rehearsal accepts no arguments")
    metadata=json.loads(subprocess.run(["docker","inspect","--format",
        '{"ports":{{json .NetworkSettings.Ports}},"networks":{{json .NetworkSettings.Networks}}}',
        CONTAINER],check=True,capture_output=True,text=True,timeout=10).stdout)
    assert metadata["ports"]["5432/tcp"]==[{"HostIp":"127.0.0.1","HostPort":PORT}]
    assert set(metadata["networks"])=={NETWORK}
    before=json.loads(query(STATE))
    assert before=={"migrations":29,"runs":1,"versions":1,"publications":1,
        "bindings":1,"activations":1,"activeHeads":1}, \
        "Requires exact preserved first-commit checkpoint; never reset to repeat"
    original=json.loads(query("""select jsonb_build_object('expected',jsonb_build_object(
      'publicationId',a.publication_id,'decisionId',a.decision_id,'runId',a.run_id,
      'requestFingerprint',a.request_fingerprint,'publicationSha256',a.publication_sha256),
      'leaseId',a.work_claim_id,'snapshot',p.snapshot)
      from terra_private.machine_publication_activations a
      join terra_private.issue_publications p on p.id=a.publication_id;"""))
    assert original["expected"]["publicationId"]==FIRST_PUBLICATION
    session=Session(ARGS)
    try:
        session.execute("set statement_timeout='15s';set lock_timeout='10s';", "READY")
        for phase in ("rollback","commit"):
            session.execute("begin;"+successor_stage_sql(),"STAGED")
            meta=json.loads(session.execute(META,"META")[0])
            result=json.loads(session.execute(activation_call(meta,FIRST_PUBLICATION),"ACTIVATED")[0])
            checked=validate_result(result,meta["expected"])
            assert checked["issue"]["revision"]==2
            assert checked["issue"]["claims"][0]["assertion"]=="In 2025, the fictional share was 28.1%."
            # Another session still reads the old committed head and old value.
            visible=json.loads(query("select terra_private.read_issue_candidate('fictional-country','fictional-share');"))
            assert visible["publication"]["id"]==FIRST_PUBLICATION
            session.execute(phase+";","CLOSED")
            if phase=="rollback":
                assert json.loads(query(STATE))==before
                print("PASS successor rollback: complete checked revision disappears; original head/data unchanged.",flush=True)
            else:
                committed=result
                committed_meta=meta
                print("PASS successor commit: checked revision 2 replaces the head atomically; original bytes retained.",flush=True)
        candidate=json.loads(query("select terra_private.read_issue_candidate('fictional-country','fictional-share');"))
        assert validate_result(dict(committed,candidate=candidate),committed_meta["expected"])["issue"]==checked["issue"]
        old=json.loads(session.execute(activation_call(original,None),"OLDREPLAY")[0])
        assert validate_result(old,original["expected"])=={
            "kind":"receipt","status":"already_activated","visibilityState":"pending","currentHeadMatches":False}
        latest=json.loads(session.execute(activation_call(committed_meta,FIRST_PUBLICATION),"NEWREPLAY")[0])
        assert validate_result(latest,committed_meta["expected"])["currentHeadMatches"] is True
        print("PASS old/new replay: old receipt reports historical head; neither retry rewrites or advances a head.",flush=True)
        preserved=json.loads(query("select snapshot from terra_private.issue_publications where id="+quote(FIRST_PUBLICATION)+";"))
        assert preserved==original["snapshot"]
        assert json.loads(query(STATE))=={"migrations":29,"runs":2,"versions":2,"publications":2,
            "bindings":2,"activations":2,"activeHeads":1}
        print("PASS committed revision read: invented 28.1%, revision 2, checked citation; original 27.4% snapshot unchanged.")
    finally:
        session.close()
    print("Retained two invented publications in isolated evidence. No primary write or live publication.")
    return 0


if __name__=="__main__":
    raise SystemExit(main())
