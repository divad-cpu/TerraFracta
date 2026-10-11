"""Closed first/successor fixture API, separate from retained v1/v2.

The owner selects exactly one of two already inspected invented templates.
No new operation, column, role, credential, primary migration or real source.
Expected predecessor and decision identity come only from that closed template.
"""
from pathlib import Path
import sys
from scripts.build_fictional_publication_api_v2 import build_publication_api_v2
from scripts.fictional_successor_stage_sql import FIRST_PUBLICATION,SECOND_DECISION

FIRST_DECISION='88888888-8888-4888-8888-888888888888'
SECOND_PUBLICATION='6ac005f4-f9a0-5021-a3b5-28e1f1607397'

def once(body,old,new):
    if body.count(old)!=1:raise ValueError('Pinned successor API marker changed')
    return body.replace(old,new,1)

def build_publication_api_v3():
    body=build_publication_api_v2()
    marker=' return p;\nend;\n$scope$;'
    gate=f""" if (
   (p.trusted_fixture #>> '{{draft,publication,revision}}'='1'
    and p.trusted_fixture #>> '{{draft,publication,id}}'='{FIRST_PUBLICATION}'
    and p.trusted_fixture #>> '{{draft,publication,previousPublicationId}}' is null)
   or (p.trusted_fixture #>> '{{draft,publication,revision}}'='2'
    and p.trusted_fixture #>> '{{draft,publication,id}}'='{SECOND_PUBLICATION}'
    and p.trusted_fixture #>> '{{draft,publication,previousPublicationId}}'='{FIRST_PUBLICATION}')
 ) is not true then raise exception 'Only closed first/successor fixture identities are permitted' using errcode='42501';end if;
"""
    body=once(body,marker,gate+marker)
    decision="(case when (authority.trusted_fixture #>> '{draft,publication,revision}')::integer=2 then '"+SECOND_DECISION+"'::uuid else '"+FIRST_DECISION+"'::uuid end)"
    if body.count("'"+FIRST_DECISION+"'")!=4:raise ValueError('Pinned successor decision references changed')
    body=body.replace("'"+FIRST_DECISION+"'",decision)
    old="select (payload #>> '{draft,publication,issueId}')::uuid from activation_input;"
    body=once(body,old,old[:-1]+' on conflict(issue_id) do nothing;')
    body=once(body,'(id, issue_id, revision, publication_kind, snapshot, dependency_manifest, created_at)',
        '(id, issue_id, revision, publication_kind, snapshot, dependency_manifest, created_at, predecessor_id)')
    body=once(body,"values (pub_id, fixture_issue_id, 1, 'accepted', snap, manifest, at_time);",
        "values (pub_id, fixture_issue_id, (fixture #>> '{draft,publication,revision}')::integer,\n"
        " case when (fixture #>> '{draft,publication,revision}')='2' then 'correction' else 'accepted' end,\n"
        " snap, manifest, at_time, nullif(fixture #>> '{draft,publication,previousPublicationId}','')::uuid);")
    body=once(body,decision+",null,fixture->>'requestFingerprint'",decision+",nullif(fixture #>> '{draft,publication,previousPublicationId}','')::uuid,fixture->>'requestFingerprint'")
    return '-- Fictional API revision 3: exact first/successor templates; predecessors and earlier candidates retained.\n'+body

if __name__=='__main__':
    if sys.argv[1:]:raise RuntimeError('Fixed successor composer accepts no arguments')
    sys.stdout.write(build_publication_api_v3())
