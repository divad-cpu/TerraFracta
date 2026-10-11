"""Compose a closed shadow-only SCRAM experiment from preserved response guards.

Never a primary migration or generic runner API. No LOGIN/grant/credential is
created here. The four exported operations bind one owner-selected fixture.
"""
from pathlib import Path
import re
ROOT=Path(__file__).resolve().parents[1]


def build_capture_api():
    base=(ROOT/'research/pending/TF009_fictional_response_identity.sql').read_text()
    base=base.replace('terra_response_test_api','terra_capture_test_api')
    base=base.replace("max_body_bytes between 1 and 100","max_body_bytes between 1 and 65536")
    base=base.replace("'https://example.org/fictional-response'","'https://example.org/fictional-table/data?format=json'")
    marker=' enabled boolean not null default false\n'
    assert base.count(marker)==1
    base=base.replace(marker,""" enabled boolean not null default false,
 work_claim_id uuid not null references terra_private.update_run_work_claims(id),
 source_version_id uuid not null,
 item_key text not null check(item_key='fictional-share:2025'),
 body_sha256 text not null check(body_sha256~'^[0-9a-f]{64}$'),
 body_bytes integer not null check(body_bytes between 1 and 65536)
""")
    # Pin the originating work fence; a successor needs a separately provisioned
    # identity, never automatic adoption of another claim's rights.
    marker=' return p;\nend;\n$scope$;'
    assert base.count(marker)==1
    base=base.replace(marker,""" if p.work_claim_id is distinct from (select claim_id from terra_private.update_run_work_state where run_id=p.run_id)
  or p.body_bytes>p.max_body_bytes then
  raise exception 'Fictional capture scope has a different work fence' using errcode='42501';
 end if;
 return p;
end;
$scope$;""")
    parts=[base]
    for name in ('TF009_fictional_response_commit_scope.sql','TF009_fictional_response_confirmation.sql'):
        parts.append((ROOT/'research/pending'/name).read_text().replace('terra_response_test_api','terra_capture_test_api'))
    # Keep exact independent guard bodies. Only these two deferred contexts
    # get closed definer copies, each enforcing principal/run/fence again.
    for path,function,table,trigger in (
      ('research/pending/TF009_response_reservations.sql','check_response_source_check','update_run_source_checks','response_source_check_commit_guard'),
      ('supabase/migrations/20260930182359_tf009_source_checks_and_processing_completion.sql','check_run_closeout','update_run_closeouts','run_closeout_commit_guard')):
        original=(ROOT/path).read_text()
        match=re.search(r'create function terra_private\.'+function+r'\(\).*?\$guard\$;',original,re.S)
        assert match and match.group().count('security invoker')==1
        copy=match.group().replace('terra_private.'+function+'()', 'terra_capture_test_api.'+function+'()').replace('security invoker','security definer',1)
        copy=copy.replace('begin\n',"""begin
 if session_user not in('postgres','supabase_admin') then
  declare authority terra_capture_test_api.principal_scopes%rowtype;
  begin
   authority:=terra_capture_test_api.current_scope();
   if authority.run_id is distinct from new.run_id or authority.work_claim_id is distinct from new.work_claim_id then
    raise exception 'Capture COMMIT is outside principal scope' using errcode='42501';
   end if;
  end;
 end if;
""",1)
        parts.append(copy+f'\ndrop trigger {trigger} on terra_private.{table};\ncreate constraint trigger {trigger} after insert on terra_private.{table}\n deferrable initially deferred for each row execute function terra_capture_test_api.{function}();\n')
    parts.append((ROOT/'research/pending/TF009_fictional_capture_api_operations.sql').read_text())
    return '-- CLOSED FICTIONAL SHADOW EXPERIMENT ONLY. No primary/runtime authorization.\n'+ '\n'.join(parts)


if __name__=='__main__':print(build_capture_api(),end='')
