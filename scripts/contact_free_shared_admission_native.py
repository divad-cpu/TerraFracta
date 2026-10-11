"""Actual invented shared admission witnesses, only in the fixed fresh cluster."""
from concurrent.futures import ThreadPoolExecutor
import json
import time
from uuid import uuid4


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def exercise_shared_admission(*, sql, check, proof, received, day, target, execution):
    prefix = 'tf_shared_admission_trial.'
    def value(text, role=None):
        return json.loads(sql(text, role=role).stdout.strip())
    def call(name, args, role='tf_shared_writer'):
        return value('select '+prefix+name+'('+','.join(args)+');',role)
    def keys():
        return [str(uuid4()),str(uuid4())]
    def begin(selected=None,operation=None,at=received):
        selected=selected or keys();operation=operation or str(uuid4())
        return call('begin_invented',[quote(execution),quote(operation),*map(quote,selected),str(at//900000)])
    def release(reservation):
        return call('release_prewrite_invented',[quote(execution),quote(reservation['ticket'])])
    def packet():
        return {'schemaVersion':1,'requestId':str(uuid4()),'draft':{'target':target,'fields':{
            'kind':'missing_context','details':'INVENTED_UNTRUSTED_SHARED_CANARY blåbær 日本語','sourceUrl':'https://example.org/INVENTED_ONLY'}}}
    def arm(reservation,selected):
        return call('arm_invented',[quote(execution),quote(reservation['ticket']),quote(selected['requestId']),quote(json.dumps(selected['draft']['target']))+'::jsonb'])
    def write_query(reservation,selected):
        return 'select '+prefix+'write_invented('+quote(execution)+','+quote(reservation['ticket'])+','+quote(json.dumps(selected))+'::jsonb);'
    def write(reservation,selected):
        return value(write_query(reservation,selected),'tf_shared_writer')
    def resolve_query(reservation):
        return 'select '+prefix+'resolve_invented('+quote(execution)+','+quote(reservation['ticket'])+');'
    def resolve(reservation):
        return value(resolve_query(reservation),'tf_shared_recovery')
    def counts():
        return call('counts_invented',[quote(execution)],'tf_shared_recovery')
    def count(table):
        return int(sql('select count(*) from '+table+';').stdout.strip())
    def now(at):
        sql(f'begin;update tf_contact_free_trial.clock_state set now_ms={at};update tf_bound_trial.clock_state set now_ms={at};commit;')
    def no_stage(label):
        check(label+'_stage_records',count('tf_bound_trial.records'),0)
        check(label+'_stage_payloads',count('tf_bound_trial.payloads'),0)

    expected={'begin_invented(uuid,uuid,uuid,uuid,bigint)':'tf_shared_writer',
        'release_prewrite_invented(uuid,uuid)':'tf_shared_writer','arm_invented(uuid,uuid,uuid,jsonb)':'tf_shared_writer',
        'write_invented(uuid,uuid,jsonb)':'tf_shared_writer','resolve_invented(uuid,uuid)':'tf_shared_recovery',
        'counts_invented(uuid)':'tf_shared_recovery','lock_context(uuid)':None}
    for role in ['tf_trial_public','tf_trial_writer','tf_write_recovery','tf_trial_reviewer','tf_shared_writer','tf_shared_recovery']:
        for function,principal in expected.items():
            check(role+'_facade_'+function,sql('select has_function_privilege('+quote(role)+','+quote(prefix+function)+",'execute');").stdout.strip(), 't' if principal==role else 'f')
        for table in ['context','buckets','reservations','accepted']:
            check(role+'_direct_'+table+'_denied',sql('select * from '+prefix+table+';',role=role,allowed=True).returncode!=0,True)
        check(role+'_owner_switch_denied',sql('set role tf_bound_owner;',role=role,allowed=True).returncode!=0,True)
    check('all_fixture_roles_nologin',sql("select bool_and(not rolcanlogin and not rolsuper and not rolbypassrls and not rolcreaterole) from pg_roles where rolname like 'tf_%';").stdout.strip(),'t')
    check('direct_composed_writer_revoked',sql("select has_function_privilege('tf_trial_writer','tf_contact_free_write_trial.submit_invented(uuid,uuid,jsonb,bigint)','execute');").stdout.strip(),'f')
    check('direct_composed_recovery_revoked',sql("select has_function_privilege('tf_write_recovery','tf_contact_free_write_trial.recover_invented(uuid,uuid,uuid,jsonb,bigint)','execute');").stdout.strip(),'f')
    check('unknown_ticket_release_held',release({'ticket':str(uuid4())}),{'kind':'held'})
    selected=keys()
    for n in range(5):
        reservation=begin(selected);check('address_attempt_'+str(n),reservation['kind'],'reserved_invented')
        check('prewrite_release_'+str(n),release(reservation),{'kind':'released_invented'})
    check('address_sixth_attempt_held',begin(selected),{'kind':'held'})
    check('address_no_private_body',count('tf_contact_free_trial.records'),0)

    # Three actual independent connections contend for the same persisted two slots.
    with ThreadPoolExecutor(max_workers=3) as pool:
        outcomes=list(pool.map(lambda _:begin(),range(3)))
    reservations=[r for r in outcomes if r['kind']=='reserved_invented']
    check('concurrent_three_connections_two_reservations',len(reservations),2)
    check('concurrent_third_held',sum(r['kind']=='held' for r in outcomes),1)
    check('new_connection_same_pending_count',counts()['reserved'],2)
    for r in reservations: release(r)
    first=begin(); p=packet();check('first_arm',arm(first,p)['kind'],'armed_invented')
    check('armed_is_unknown_before_sql',counts()['unknown'],1)
    check('unknown_blocks_new_connection',begin(),{'kind':'held'})
    check('armed_prewrite_release_cannot_clear',release(first),{'kind':'held'})
    written=write(first,p);check('actual_sql_write_confirmed',written['outcome'],'confirmed')
    report=written['result']['reportId']
    check('committed_ack_not_implicit_quota_settlement',counts()['unknown'],1)
    check('actual_committed_custody',count('tf_contact_free_trial.records'),1)
    check('new_connection_after_lost_ack_still_held',begin(),{'kind':'held'})
    check('second_dispatch_held_no_retry',write(first,p),{'kind':'held'})
    settled=resolve(first);check('explicit_original_effect',settled['result']['replayed'],False)
    check('explicit_once_accepted',counts()['acceptedInHour'],1)
    check('explicit_once_open',counts()['openReports'],1)
    check('explicit_once_released',counts()['reserved'],0)
    check('repeated_settlement_held',resolve(first),{'kind':'held'})
    check('cannot_reuse_completed_operation',begin(operation=first['operationId']),{'kind':'held'})
    no_stage('first')
    repeat=begin();arm(repeat,p);check('new_operation_same_request_repeat',write(repeat,p)['result']['replayed'],True)
    check('repeat_recovered_original_report',resolve(repeat)['result']['reportId'],report)
    check('repeat_not_new_hourly_count',counts()['acceptedInHour'],1)
    check('repeat_not_new_open_count',counts()['openReports'],1)
    no_stage('repeat')
    absent=begin();absent_packet=packet();arm(absent,absent_packet)
    check('explicit_absence_fence_known_nonwrite',resolve(absent)['outcome'],'known_nonwrite')
    check('late_same_ticket_write_after_fence_held',write(absent,absent_packet),{'kind':'held'})
    check('absence_no_new_count',counts()['acceptedInHour'],1)
    check('absence_no_new_report',count('tf_contact_free_trial.records'),1)

    # Actual write holds the global reservation lock until its SQL transaction ends.
    racing=begin();racing_packet=packet();arm(racing,racing_packet)
    with ThreadPoolExecutor(max_workers=2) as pool:
        pending=pool.submit(sql,"begin;set application_name='tf_shared_owned_physical';"+write_query(racing,racing_packet)+'select pg_sleep(0.5);commit;',role='tf_shared_writer')
        seen=False
        for _ in range(50):
            if sql("select count(*) from pg_stat_activity where application_name='tf_shared_owned_physical' and wait_event='PgSleep';").stdout.strip()=='1':
                seen=True;break
            time.sleep(0.01)
        check('actual_write_holds_owned_transaction',seen,True)
        started=time.monotonic();recovered=pool.submit(resolve,racing)
        check('recover_waits_actual_write_not_absence',recovered.result(timeout=10)['outcome'],'confirmed')
        check('recovery_lock_wait_observed',time.monotonic()-started>0.15,True)
        check('physical_sql_committed_once',pending.result(timeout=10).returncode,0)
    check('concurrent_effect_counted_once',counts()['acceptedInHour'],2)
    no_stage('race')

    # Whole settlement rollback cannot count/release an unresolved reservation.
    fault=begin();fault_packet=packet();arm(fault,fault_packet);write(fault,fault_packet)
    sql("create function public.shared_settlement_fault() returns trigger language plpgsql as $$begin raise exception 'Invented settlement fault';end$$;create trigger shared_settlement_fault before insert on tf_shared_admission_trial.accepted for each row execute function public.shared_settlement_fault();")
    check('settlement_fault_held',resolve(fault),{'kind':'held'})
    check('settlement_fault_keeps_unknown',counts()['unknown'],1)
    check('settlement_fault_no_partial_hourly_count',counts()['acceptedInHour'],2)
    check('settlement_fault_keeps_actual_custody',count('tf_contact_free_trial.records'),3)
    sql('drop trigger shared_settlement_fault on tf_shared_admission_trial.accepted;')
    check('fault_explicit_recovery',resolve(fault)['outcome'],'confirmed')
    check('fault_effect_counted_once',counts()['acceptedInHour'],3)

    # Shared limits are fixed from accepted policy. Owner-seeded synthetic current
    # counts below are explicitly fixture-only and rolled back, not real history.
    global_probe="begin;insert into tf_shared_admission_trial.accepted select "+str(received)+" from generate_series(1,57);select "+prefix+"begin_invented("+quote(execution)+','+quote(str(uuid4()))+','+','.join(map(quote,keys()))+','+str(received//900000)+');rollback;'
    check('sixty_shared_global_backpressure',value(global_probe),{'kind':'held'})
    check('seeded_global_probe_rolled_back',counts()['acceptedInHour'],3)
    open_probe="begin;insert into tf_contact_free_trial.records select md5('shared-report-'||n)::uuid,md5('shared-request-'||n)::uuid,"+quote(json.dumps(target))+f"::jsonb,{received},null,null,null,null,null,1 from generate_series(1,197)n;select "+prefix+'begin_invented('+quote(execution)+','+quote(str(uuid4()))+','+','.join(map(quote,keys()))+','+str(received//900000)+');rollback;'
    check('two_hundred_shared_open_backpressure',value(open_probe),{'kind':'held'})
    check('seeded_open_probe_rolled_back',counts()['openReports'],3)
    check('close_actual_private_record',value('select tf_contact_free_trial.close_private('+quote(report)+",'corrected','INVENTED_SHARED_RESOLUTION');",'tf_trial_reviewer')['kind'],'closed_private')
    check('new_connection_observes_closed_open_count',counts()['openReports'],2)
    check('closure_never_refunds_hourly_acceptance',counts()['acceptedInHour'],3)

    prior_at=received+300000;now(prior_at)
    rotate=keys();prior=begin(rotate,at=prior_at);release(prior)
    at=received+900000;now(at)
    current=[str(uuid4()),rotate[0]]
    for n in range(4):
        r=begin(current,at=at);check('rotated_attempt_'+str(n),r['kind'],'reserved_invented');release(r)
    check('rotated_shared_fifth_prior_plus_current_hold',begin(current,at=at),{'kind':'held'})
    now(received+1800000);check('thirty_minute_original_address_rows_removed',counts()['addressBuckets'],1)
    now(received+3600000);check('hourly_count_original_window_expires',counts()['acceptedInHour'],0)
    check('all_old_address_rows_physically_removed',counts()['addressBuckets'],0)
    expired=begin(at=received+3600000);expired_packet=packet();arm(expired,expired_packet)
    now(expired['admittedAtMs']+180*day)
    check('expired_operation_unknown_debt_held',counts()['unknown'],1)
    check('expired_identity_fields_stripped',sql('select operation_id is null and admitted_at_ms is null and request_id is null and target is null from tf_shared_admission_trial.reservations;').stdout.strip(),'t')
    check('expired_reference_cannot_resolve_or_renew',resolve(expired),{'kind':'held'})
    check('expired_reference_cannot_release',release(expired),{'kind':'held'})
    check('expired_unknown_blocks_new_connection',begin(at=expired['admittedAtMs']+180*day),{'kind':'held'})
    check('reservation_metadata_excludes_body',sql("select bool_and(column_name not in('details','source_url','digest','address','current_key','previous_key')) from information_schema.columns where table_schema='tf_shared_admission_trial' and table_name='reservations';").stdout.strip(),'t')
    # Clock reversal permanently invalidates this fixture; a new connection cannot
    # manufacture fresh continuity from counters or an empty reservation list.
    check('source_clock_rollback_is_refused',sql(f'update tf_contact_free_trial.clock_state set now_ms={received};',allowed=True).returncode!=0,True)
    # Simulate an owner-seeded latest admission observation newer than both
    # source clocks; the closed limiter invalidates rather than renews it.
    sql('update tf_shared_admission_trial.context set last_now_ms=last_now_ms+1;')
    check('admission_clock_rollback_holds_context',counts(),{'kind':'held'})
    check('admission_rollback_persisted_unknown',sql('select known from tf_shared_admission_trial.context;').stdout.strip(),'f')
    now(expired['admittedAtMs']+180*day+1)
    check('forward_clock_cannot_reopen_unknown_context',counts(),{'kind':'held'})
    (proof/'SHARED_ADMISSION_LIMITS.json').write_text(json.dumps({'inventedOnly':True,'concurrent':2,'addressAttempts':5,'acceptedPerHour':60,'openReports':200,'actualWorkerConnections':3,'realHostRestartVerified':False},indent=2)+'\n')
