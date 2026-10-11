"""Fixed rollback-only synthetic visibility controls in retained native DB."""
from datetime import datetime,timezone,timedelta
from hashlib import sha256
import json
from pathlib import Path
import re
import sys
from scripts.check_response_native_compatibility import DB,execute,ROOT,TRIAL
from scripts.fictional_response_backend import verify_target
from scripts.check_run_admission_concurrency import quote
from workers.visibility_attempts import (SurfaceObservation,VisibilityAttempt,VisibilityExpectation,
 canonical_visibility_attempt,evaluate_visibility_attempt)
from workers.update_run_completion import SURFACES


def inputs():
    return json.loads(execute("select jsonb_build_object('runId',r.id,'fingerprint',r.request_fingerprint,'publicationId',a.publication_id,"+
      "'publicationHash',a.publication_sha256,'activatedAt',a.activated_at,'finishedAt',c.finished_at,'summary',c.summary::text,"+
      "'sourceIds',(select jsonb_agg(source_version_id::text) from terra_private.issue_publication_citations where publication_id=a.publication_id)) "+
      'from terra_private.update_runs r join terra_private.machine_publication_activations a on a.run_id=r.id join terra_private.update_run_closeouts c on c.run_id=r.id;'))


def attempt(data,*,at=None,observations=True):
    at=at or datetime.now(timezone.utc)
    return VisibilityAttempt(data['runId'],data['publicationId'],data['publicationHash'],tuple(data['sourceIds']),at,at,
      tuple(SurfaceObservation(surface,'observed',at,data['publicationId'],data['publicationHash'],tuple(data['sourceIds'])) for surface in sorted(SURFACES)) if observations else ())


def main():
    if sys.argv[1:]:raise RuntimeError('Fixed synthetic rollback check accepts no arguments')
    verify_target(migration_count=34);assert execute('select current_database();').strip()==DB
    before=execute('select count(*) from terra_private.synthetic_visibility_attempts;').strip()
    data=inputs();row=attempt(data);canonical=canonical_visibility_attempt(row)
    expected=VisibilityExpectation(data['runId'],data['publicationId'],data['publicationHash'],tuple(data['sourceIds']),
      datetime.fromisoformat(data['activatedAt']),datetime.fromisoformat(data['finishedAt']))
    assert evaluate_visibility_attempt(row,expected,current_publication_id=data['publicationId'],now=datetime.now(timezone.utc)).state=='matched'
    changed=canonical_visibility_attempt(attempt(data,at=row.finished_at,observations=False))
    payload=json.loads(canonical);payload['observations']=[{'checkedAt':row.finished_at.isoformat(timespec='microseconds'),
      'surface':'issue','outcome':None,'observedPublicationId':None,'observedPublicationSha256':None,'sourceVersionIds':[]}]
    null=json.dumps(payload,sort_keys=True,separators=(',',':'))
    payload=json.loads(canonical);payload['scope']='rendered';upgraded=json.dumps(payload,sort_keys=True,separators=(',',':'))
    payload=json.loads(canonical);payload['rawSource']='fictional-private-placeholder';private=json.dumps(payload,sort_keys=True,separators=(',',':'))
    vals=','.join(map(quote,(data['runId'],data['fingerprint'],data['publicationId'],data['publicationHash'],canonical,changed,null,upgraded,private,data['summary'])))
    sql=(ROOT/'research/pending/TF009_synthetic_visibility_attempts.test.sql').read_text().replace('-- TF_SYNTHETIC_VISIBILITY_INPUT',
      'create temporary table visibility_input(run_id uuid,fingerprint text,publication_id uuid,publication_hash text,canonical text,changed text,null_outcome text,upgraded_scope text,private_fields text,original_closeout text);insert into visibility_input values('+vals+');')
    tap=execute(sql);passed=len(re.findall(r'^ok \d+\b',tap,re.M));plan=re.search(r'^1\.\.(\d+)$',tap,re.M)
    log=TRIAL/'SYNTHETIC_VISIBILITY_TAP.log';log.write_text(tap);log.chmod(0o600)
    assert plan and int(plan.group(1))==passed and passed==25 and not re.search(r'^not ok|^# (?:Looks like|Failed)',tap,re.M),tap
    assert execute('select count(*) from terra_private.synthetic_visibility_attempts;').strip()==before
    assert inputs()['summary']==data['summary']
    print('PASS 25 rolled-back synthetic visibility controls; original closeout and committed rows unchanged.')
    return 0

if __name__=='__main__':raise SystemExit(main())
