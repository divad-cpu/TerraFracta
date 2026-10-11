"""Fixed read-only final schema/permission audit; no service or SQL changes."""
from datetime import datetime,timezone
import json
import sys
from scripts.fictional_response_backend import verify_target,query,STATE,CONTAINER
from scripts.check_response_native_compatibility import execute,DB,TRIAL
from scripts.check_run_admission_draft import query as owner_query
from workers.ssb_14059_raw_store import inspect_private_ssb_14059_pairs


def main():
    if sys.argv[1:]:raise RuntimeError('Fixed closeout audit accepts no arguments')
    verify_target(migration_count=34)
    evidence=TRIAL/'FINAL_DATABASE_AUDIT.json';assert not evidence.exists()
    state=json.loads(query(STATE));assert state=={'migrations':34,'runs':29,'versions':1,'checks':2,'manifests':1,'activations':0,'closeouts':1}
    assert query("select count(*) from pg_roles where rolname like 'terra_response_%' and rolcanlogin;")=='0'
    ledger=json.loads(query("select jsonb_build_object('tables',count(*),'rls',bool_and(c.relrowsecurity),'fields',sum((select count(*) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped))) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='terra_private' and c.relname in ('source_response_reservations','source_response_dispatches','source_response_settlements');"))
    assert ledger=={'tables':3,'rls':True,'fields':17}
    assert execute('select current_database();').strip()==DB
    visible=json.loads(execute("select jsonb_build_object('attempts',(select count(*) from terra_private.synthetic_visibility_attempts),'fields',(select count(*) from pg_attribute where attrelid='terra_private.synthetic_visibility_attempts'::regclass and attnum>0 and not attisdropped),'rls',(select relrowsecurity from pg_class where oid='terra_private.synthetic_visibility_attempts'::regclass),'closeouts',(select count(*) from terra_private.update_run_closeouts),'activations',(select count(*) from terra_private.machine_publication_activations));"))
    assert visible=={'attempts':6,'fields':8,'rls':True,'closeouts':1,'activations':1}
    primary=json.loads(owner_query('supabase_db_terrafracta-local',"select jsonb_build_object('migrations',(select count(*) from supabase_migrations.schema_migrations),'runs',(select count(*) from terra_private.update_runs),'versions',(select count(*) from terra_private.source_versions),'checks',(select count(*) from terra_private.update_run_source_checks),'activations',(select count(*) from terra_private.machine_publication_activations),'publications',(select count(*) from terra_private.issue_publications),'applicationLogins',(select count(*) from pg_roles where rolname in('terra_collector','terra_operator','terra_reviewer','terra_issue_reader') and rolcanlogin),'responseLedgerPresent',to_regclass('terra_private.source_response_reservations') is not null,'syntheticVisibilityPresent',to_regclass('terra_private.synthetic_visibility_attempts') is not null);"))
    assert primary=={'migrations':29,'runs':0,'versions':0,'checks':0,'activations':0,'publications':0,'applicationLogins':0,'responseLedgerPresent':False,'syntheticVisibilityPresent':False}
    inventory=inspect_private_ssb_14059_pairs();assert inventory==()
    maximum=json.loads((TRIAL/'MAXIMUM_LIFETIME.json').read_text());assert maximum['actualElapsedSeconds']>=3600 and maximum['renewals']==238
    assert maximum['lateRenewalDenied'] and maximum['lateDispatchReplayDenied'] and maximum['lateRefundDenied']
    evidence.write_text(json.dumps({'evidenceKind':'readonly_final_trial_permissions_and_primary_audit','observedAt':datetime.now(timezone.utc).isoformat(),
      'responseTrial':state,'ledgerSchema':ledger,'visibilityDatabase':DB,'visibilityTrial':visible,'primary':primary,
      'testRoleLogins':0,'liveRawPairs':0,'maximumLifetimeCompleted':True,'actualSourceFetches':0,'primaryChanged':False},indent=2)+'\n');evidence.chmod(0o600)
    print('PASS final readback: isolated histories retained, all test identities NOLOGIN; primary 29/empty/no new ledgers, live raw store empty.')
    return 0

if __name__=='__main__':raise SystemExit(main())
