"""Retain and correct a nullable-outcome validator gap only in synthetic trial."""
from datetime import datetime,timezone
from hashlib import sha256
import json
import re
import sys
from scripts.check_response_native_compatibility import DB,execute,ROOT,TRIAL
from scripts.fictional_response_backend import verify_target
from scripts.check_run_admission_concurrency import quote
from workers.visibility_attempts import VisibilityAttempt,canonical_visibility_attempt


def main():
    if sys.argv[1:]:raise RuntimeError('Fixed null correction accepts no arguments')
    verify_target(migration_count=34);assert execute('select current_database();').strip()==DB
    evidence=TRIAL/'SYNTHETIC_VISIBILITY_NULL_CORRECTION.json';assert not evidence.exists()
    original=json.loads((TRIAL/'SYNTHETIC_VISIBILITY_INSTALL.json').read_text())
    activation=original['activation'];now=datetime.now(timezone.utc)
    sources=tuple(json.loads(execute('select jsonb_agg(source_version_id::text) from terra_private.issue_publication_citations where publication_id='+quote(activation['publicationId'])+';')))
    base=json.loads(canonical_visibility_attempt(VisibilityAttempt(activation['runId'],activation['publicationId'],activation['publicationSha256'],sources,now,now,())))
    base['observations']=[{'checkedAt':now.isoformat(timespec='microseconds'),'observedPublicationId':None,'observedPublicationSha256':None,
      'outcome':None,'sourceVersionIds':[],'surface':'issue'}]
    malformed=json.dumps(base,sort_keys=True,separators=(',',':'))
    result=json.loads(execute('select terra_private.validate_synthetic_visibility_attempt('+quote(malformed)+');'))
    assert result['observations'][0]['outcome'] is None
    current=(ROOT/'research/pending/TF009_synthetic_visibility_attempts.sql').read_text()
    prior=current.replace("or jsonb_typeof(e->'surface') is distinct from 'string' or e->>'surface'", "or e->>'surface'").replace("or jsonb_typeof(e->'outcome') is distinct from 'string' or e->>'outcome'", "or e->>'outcome'")
    assert sha256(prior.encode()).hexdigest()==original['candidateSha256']
    saved=TRIAL/'SYNTHETIC_VISIBILITY_ORIGINAL.sql';saved.write_text(prior);saved.chmod(0o600)
    fn=re.search(r'create function terra_private.validate_synthetic_visibility_attempt[\s\S]+?\$validate\$;',current).group().replace('create function','create or replace function',1)
    execute('begin;'+fn+'commit;')
    try:execute('select terra_private.validate_synthetic_visibility_attempt('+quote(malformed)+');')
    except RuntimeError as exc:assert 'Synthetic visibility attempt is invalid' in str(exc)
    else:raise AssertionError('NULL observation accepted after correction')
    evidence.write_text(json.dumps({'evidenceKind':'isolated_synthetic_null_outcome_correction','observedAt':datetime.now(timezone.utc).isoformat(),
      'originalSha256':sha256(prior.encode()).hexdigest(),'correctedSha256':sha256(current.encode()).hexdigest(),
      'nullOutcomeInitiallyAcceptedByValidator':True,'correctedNullOutcomeDenied':True,'tableRowsWritten':0,
      'originalSqlRetained':True,'primaryChanged':False,'runtimeVerified':False},indent=2)+'\n');evidence.chmod(0o600)
    print('PASS reproduced NULL-outcome validator gap and corrected explicit string checks; original SQL retained, no observation rows written.')
    return 0

if __name__=='__main__':raise SystemExit(main())
