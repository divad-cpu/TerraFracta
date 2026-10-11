"""Isolated first-capture candidate using measured, not preknown, body hashes.

Reuses installed source/run/response guards and the closed pending-pair API.
No primary migration, LOGIN, source fetch, raw retention or usable state exists.
The custodian must independently validate unknown bytes before calling store.
"""
from pathlib import Path
from scripts.build_fictional_ssb_pair_api import build_fictional_ssb_pair_api,once,SCHEMA

ROOT=Path(__file__).resolve().parents[1]


def build_unknown_ssb_pair_api():
    sql=build_fictional_ssb_pair_api()
    for old,new in (
      ("body_sha256 text not null check", "body_sha256 text check"),
      (" body_bytes integer not null check", " body_bytes integer check"),
      ("trusted_manifest text not null check", "trusted_manifest text check"),
      ("  or p.body_bytes>p.max_body_bytes then", "  or p.body_sha256 is not null or p.body_bytes is not null or p.trusted_manifest is not null then")):
        sql=once(sql,old,new)
    old=""" if p_outcome='measured' and (p_hash is distinct from p.body_sha256 or p_body_bytes is distinct from p.body_bytes) then
  raise exception 'Measured paired fixture differs from trusted body' using errcode='42501';
 end if;
"""
    sql=once(sql,old,'')
    operations=(ROOT/'research/pending/TF009_fictional_ssb_pair_api_operations.sql').read_text()
    replacement=(ROOT/'research/pending/TF009_unknown_ssb_pair_api_operations.sql').read_text()
    sql=once(sql,operations,replacement)
    return '-- ISOLATED UNKNOWN-FIRST-CAPTURE CANDIDATE; NO LIVE AUTHORITY.\n'+sql
