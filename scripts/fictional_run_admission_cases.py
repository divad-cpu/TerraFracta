"""Closed fictional requests for cross-language database admission checks."""

from __future__ import annotations

from dataclasses import replace
from decimal import Decimal
import json

from workers.missing_run_monitor import oslo_weekly_due_at_utc
from workers.update_request_identity import RunLimits, UpdateRequest, canonical_update_request


def fictional_request() -> UpdateRequest:
    return UpdateRequest(
        request_key="fictional:admission:v1", trigger="manual", scheduled_due_at=None,
        actor_id="runner:fictional", scope="fictional-country", mode="shadow",
        strategy="incremental", code_version="local-rehearsal-v1",
        policy_version="fictional-policy-v1",
        limits=RunLimits(30, 2_000_000, 0, 0, 0, 1, 300, Decimal(0), Decimal(0)),
    )


def admission_cases() -> list[tuple[str, str, str | None, bool]]:
    request = fictional_request()
    canonical = canonical_update_request(request)
    cases = [("manual", request.request_key, canonical, True)]
    for year, week in [(2026, 2), (2026, 40), (2027, 1)]:
        scheduled = replace(request, trigger="scheduled",
            request_key=f"weekly:{year}w{week:02d}:fictional-country",
            scheduled_due_at=oslo_weekly_due_at_utc(year, week))
        cases.append((f"scheduled-{year}-{week}", scheduled.request_key,
                      canonical_update_request(scheduled), True))
    paid = replace(request, limits=replace(request.limits, max_model_calls=1,
        max_model_input_tokens=100, max_model_output_tokens=10,
        run_cap_usd=Decimal("0.000000001"), month_cap_usd=Decimal("1000000")))
    cases.append(("paid-bounds-only-no-call",request.request_key,
                  canonical_update_request(paid), True))
    maximum = replace(request, limits=RunLimits(50,50_000_000,1000,1_000_000,
        1_000_000,5,3600,Decimal("1000000"),Decimal("1000000")))
    cases.append(("technical-maxima",request.request_key,
                  canonical_update_request(maximum),True))

    def changed(name: str, path: tuple[str, ...], value: object) -> None:
        payload = json.loads(canonical)
        parent = payload
        for key in path[:-1]:
            parent = parent[key]
        parent[path[-1]] = value
        cases.append((name,request.request_key,json.dumps(payload,sort_keys=True,
                      separators=(",",":"),ensure_ascii=True),False))

    for field in ("actor_id","code_version","policy_version"):
        for value in (None,"", "x"*121, "../space bad", "é", True):
            changed(f"{field}-{type(value).__name__}-{repr(value)[:12]}",(field,),value)
    for field,value in [("scope","fictional/country"),("scope","x"*81),
                        ("mode","public"),("mode",False),("strategy","all"),
                        ("trigger","cron"),("scheduled_due_at","2026-09-28T06:00:00+00:00")]:
        changed(f"invalid-{field}-{str(value)[:12]}",(field,),value)
    for field,values in {
        "max_items":[0,51,True,"30",30.0],
        "max_duration_seconds":[0,3601],
        "max_response_bytes":[0,50_000_001],
        "max_model_calls":[1,1001,-1],
        "max_model_input_tokens":[1,1_000_001],
        "max_model_output_tokens":[1,1_000_001],
        "max_retries":[-1,6],
        "run_cap_usd":["-0","0.0","1000001","0.0000000001","1e-999999",0],
        "month_cap_usd":["NaN","Infinity",None],
    }.items():
        for value in values:
            changed(f"invalid-{field}-{repr(value)}",("limits",field),value)
    for name,text in [("space",canonical+" "),("duplicate-root",'{"mode":"shadow",'+canonical[1:]),
                      ("duplicate-limit",canonical.replace('"max_items":30',
                       '"max_items":30,"max_items":30')), ("null","null"),
                      ("array","[]"),("invalid-json","{"),("huge","x"*4097),
                      ("missing-canonical",None)]:
        cases.append((name,request.request_key,text,False))
    for name,path in [("missing-root",("policy_version",)),
                      ("missing-limit",("limits","max_items"))]:
        payload=json.loads(canonical)
        parent=payload
        for key in path[:-1]:
            parent=parent[key]
        del parent[path[-1]]
        cases.append((name,request.request_key,json.dumps(payload,sort_keys=True,
                      separators=(",",":")),False))
    changed("extra-private-root",("secret",),"fictional-placeholder")
    changed("extra-private-limit",("limits","unbounded"),True)
    for key in ["Weekly:2026", "fictional:bad key", "x"*161, ""]:
        cases.append((f"invalid-key-{key[:20]}",key,canonical,False))
    winter = json.loads(cases[1][2])
    for due in ["2026-01-05T06:00:00+00:00", "2026-01-05T07:00:00Z",
                "2026-01-06T07:00:00+00:00", "2026-02-30T07:00:00+00:00"]:
        winter["scheduled_due_at"]=due
        cases.append((f"wrong-due-{due}",cases[1][1],json.dumps(winter,sort_keys=True,
                      separators=(",",":")),False))
    return cases


def sql_fixture_values() -> str:
    def quote(value: str | None) -> str:
        return "null" if value is None else "'"+value.replace("'","''")+"'"
    return "insert into fixture_requests values\n"+",\n".join(
        "("+",".join([quote(name),quote(key),quote(text),"true" if accepted else "false"])+")"
        for name,key,text,accepted in admission_cases())+";"
