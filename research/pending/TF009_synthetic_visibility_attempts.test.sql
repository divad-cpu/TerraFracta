\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TF_SYNTHETIC_VISIBILITY_INPUT
select is(terra_private.validate_synthetic_visibility_attempt(canonical),canonical::jsonb,'Independent canonical attempt matches SQL') from visibility_input;
create temporary table visibility_result as select terra_private.record_synthetic_visibility_attempt(run_id,fingerprint,publication_id,publication_hash,
 'fictional:visibility:rollback',canonical) as receipt from visibility_input;
select is(receipt->>'status','stored','A fresh whole attempt is stored') from visibility_result;
select is(receipt#>>'{summary,state}','matched','Four exact fictional surfaces match') from visibility_result;
select is(receipt#>>'{summary,runtimeVerified}','false','Synthetic matches cannot prove runtime visibility') from visibility_result;
select is(jsonb_array_length(receipt#>'{summary,matchedSurfaces}'),4,'All four required surfaces are derived') from visibility_result;
select is(terra_private.record_synthetic_visibility_attempt(run_id,fingerprint,publication_id,publication_hash,
 'fictional:visibility:rollback',canonical)->>'attemptId',(select receipt->>'attemptId' from visibility_result),'Exact retry acknowledges one immutable row') from visibility_input;
select is((select count(*) from terra_private.synthetic_visibility_attempts where attempt_key='fictional:visibility:rollback'),1::bigint,'Retry stores no second row');
select is(terra_private.read_latest_synthetic_visibility(run_id,publication_id)->>'attemptId',
 (select receipt->>'attemptId' from visibility_result),'Latest reader selects the whole recorded attempt') from visibility_input;
select throws_ok(format('select terra_private.record_synthetic_visibility_attempt(%L,%L,%L,%L,%L,%L)',
 run_id,fingerprint,publication_id,publication_hash,'fictional:visibility:rollback',changed),
 '23514','Synthetic visibility attempt key conflicts with original evidence','Changed observations cannot reuse an attempt key') from visibility_input;
select throws_ok(format('select terra_private.record_synthetic_visibility_attempt(%L,%L,%L,%L,%L,%L)',
 run_id,repeat('a',64),publication_id,publication_hash,'fictional:visibility:wrong-fingerprint',canonical),
 '23514','Synthetic visibility request identity is invalid','Foreign request fingerprint rejects') from visibility_input;
select throws_ok(format('select terra_private.record_synthetic_visibility_attempt(%L,%L,%L,%L,%L,%L)',
 run_id,fingerprint,publication_id,repeat('a',64),'fictional:visibility:wrong-hash',canonical),
 '23514','Synthetic visibility attempt differs from committed processing','Wrong activation hash rejects') from visibility_input;
select throws_ok($$update terra_private.synthetic_visibility_attempts set attempt_key='changed'$$,
 '23514','Automatic decision records are append-only','Recorded attempts cannot be rewritten');
select throws_ok($$delete from terra_private.synthetic_visibility_attempts$$,
 '23514','Automatic decision records are append-only','Recorded attempts cannot be deleted');
select ok((select relrowsecurity from pg_class where oid='terra_private.synthetic_visibility_attempts'::regclass),'Visibility evidence has RLS');
select ok(not has_table_privilege('terra_collector','terra_private.synthetic_visibility_attempts','INSERT'),'Collector gets no arbitrary visibility insert');
select ok(not has_table_privilege('terra_issue_reader','terra_private.synthetic_visibility_attempts','SELECT'),'Public reader gets no private attempt history');
select ok(not has_function_privilege('service_role','terra_private.record_synthetic_visibility_attempt(uuid,text,uuid,text,text,text)','EXECUTE'),'Service role gets no visibility execution');
select ok(not has_function_privilege('authenticated','terra_private.read_latest_synthetic_visibility(uuid,uuid)','EXECUTE'),'Ordinary users get no private evidence reader');
select is((select count(*) from pg_proc where pronamespace='terra_private'::regnamespace and proname in(
 'validate_synthetic_visibility_attempt','check_synthetic_visibility_attempt','summarize_synthetic_visibility','synthetic_visibility_receipt',
 'record_synthetic_visibility_attempt','read_latest_synthetic_visibility') and prosecdef),0::bigint,'All six visibility functions preserve invoker authority');
select is((select count(*) from pg_trigger where tgrelid='terra_private.synthetic_visibility_attempts'::regclass and not tgisinternal),3::bigint,'Immutable, insertion and COMMIT guards are present');
select throws_ok(format('select terra_private.validate_synthetic_visibility_attempt(%L)',null_outcome),
 '23514','Synthetic visibility attempt is invalid','Explicit canonical NULL outcome is refused') from visibility_input;
select throws_ok(format('select terra_private.validate_synthetic_visibility_attempt(%L)',upgraded_scope),
 '23514','Synthetic visibility attempt is invalid','JSON cannot upgrade synthetic scope to rendered evidence') from visibility_input;
select throws_ok(format('select terra_private.validate_synthetic_visibility_attempt(%L)',private_fields),
 '23514','Synthetic visibility attempt is invalid','Unknown private fields are refused') from visibility_input;
set constraints all immediate;
select is((select summary::text from terra_private.update_run_closeouts),(select original_closeout from visibility_input),'Original processing closeout bytes remain unchanged');
select pass('All new records remain within rolled-back synthetic evidence transaction');
select * from finish();
rollback;
