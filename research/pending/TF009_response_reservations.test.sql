\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TF_RESPONSE_RESERVATION_OVERLAY
-- TF_RESPONSE_REQUEST_CANONICAL
insert into terra_private.jurisdictions(id,display_name) values('fictional-country','Fictional response place') on conflict(id) do nothing;
insert into terra_private.source_registrations(id,source_key,publisher,exact_endpoint,
 registration_state,allow_fetch,fetch_enabled,reviewed_at) values
 ('33333333-3333-4333-8333-333333333333','fictional-response','Fictional publisher',
 'https://example.org/fictional-response','approved',true,true,clock_timestamp()-interval '1 second') on conflict(id) do nothing;
create temporary table response_context as
 select terra_private.admit_update_run('fictional:response:rollback',(select canonical from response_template)) as admission;
alter table response_context add column work jsonb;
update response_context set work=terra_private.claim_update_run_work((admission->>'runId')::uuid,
 admission->>'requestFingerprint',gen_random_uuid());
create temporary table response_result as select terra_private.reserve_source_response(
 (admission->>'runId')::uuid,admission->>'requestFingerprint',(work->>'leaseId')::uuid,
 '33333333-3333-4333-8333-333333333333','fictional:request:1',999999) as receipt from response_context;
select is(receipt->>'status','reserved','First request reserves capacity') from response_result;
select is(receipt->>'reservedBytes','1000000','Oversize probe byte is reserved before dispatch') from response_result;
select is(terra_private.response_reserved_charge((admission->>'runId')::uuid),1000000::bigint,
 'Unresolved reservation is fully charged') from response_context;
select is(terra_private.reserve_source_response((admission->>'runId')::uuid,admission->>'requestFingerprint',
 (work->>'leaseId')::uuid,'33333333-3333-4333-8333-333333333333','fictional:request:1',999999)->>'status',
 'existing','Exact key retry acknowledges immutable reservation') from response_context;
select is((select count(*) from terra_private.source_response_reservations where run_id=(select (admission->>'runId')::uuid from response_context)),1::bigint,
 'Replay does not reserve another response') from response_context;
select throws_ok(format('select terra_private.reserve_source_response(%L,%L,%L,%L,%L,1)',
 admission->>'runId',admission->>'requestFingerprint',work->>'leaseId',
 '33333333-3333-4333-8333-333333333333','fictional:request:1'),
 '23514','Response request key conflicts with reservation','Changed bounds cannot reuse key') from response_context;
select throws_ok(format('select terra_private.reserve_source_response(%L,%L,%L,%L,%L,1000000)',
 admission->>'runId',admission->>'requestFingerprint',work->>'leaseId',
 '33333333-3333-4333-8333-333333333333','fictional:request:too-big'),
 '23514','Response reservation exceeds admitted bytes or attempts','Probe byte cannot exceed shared cap') from response_context;
select is(terra_private.reserve_source_response((admission->>'runId')::uuid,admission->>'requestFingerprint',
 (work->>'leaseId')::uuid,'33333333-3333-4333-8333-333333333333','fictional:request:2',999999)->>'status',
 'reserved','Two exact half-capacity reservations fit') from response_context;
select is(terra_private.response_reserved_charge((admission->>'runId')::uuid),2000000::bigint,
 'Both unresolved requests share the same durable cap') from response_context;
select throws_ok(format('select terra_private.reserve_source_response(%L,%L,%L,%L,%L,1)',
 admission->>'runId',admission->>'requestFingerprint',work->>'leaseId',
 '33333333-3333-4333-8333-333333333333','fictional:request:3'),
 '23514','Response reservation exceeds admitted bytes or attempts','Retry count/bytes cannot grow without authority') from response_context;
select throws_ok(format('select terra_private.reserve_source_response(%L,%L,%L,%L,%L,1)',
 admission->>'runId',repeat('a',64),work->>'leaseId',
 '33333333-3333-4333-8333-333333333333','fictional:request:foreign'),
 '23514','Work lease is not current','Fingerprint substitution fails before any dispatch') from response_context;
select throws_ok(format('select terra_private.reserve_source_response(%L,%L,%L,%L,%L,1)',
 admission->>'runId',admission->>'requestFingerprint',gen_random_uuid(),
 '33333333-3333-4333-8333-333333333333','fictional:request:foreign'),
 '23514','Work lease is not current','Foreign work claim cannot spend capacity') from response_context;
select throws_ok(format('select terra_private.reserve_source_response(%L,%L,%L,%L,%L,1)',
 admission->>'runId',admission->>'requestFingerprint',work->>'leaseId',
 gen_random_uuid(),'fictional:request:foreign'),
 '23514','Response capture has no current source authority or open capture','Unknown registration fails closed') from response_context;
select throws_ok(format('select terra_private.dispatch_source_response(%L,%L,%L,%L)',
 admission->>'runId',admission->>'requestFingerprint',work->>'leaseId',
 (select receipt->>'reservationId' from response_result)),
 '23514','Response dispatch is invalid or already settled','Dispatch requires reservation from an earlier committed transaction') from response_context;
select throws_ok($$update terra_private.source_response_reservations set max_body_bytes=1$$,
 '23514','Automatic decision records are append-only','Reservation bounds cannot be rewritten');
select throws_ok($$delete from terra_private.source_response_reservations$$,
 '23514','Automatic decision records are append-only','Reservation cannot be deleted to recover capacity');
select ok((select bool_and(relrowsecurity) from pg_class where oid in(
 'terra_private.source_response_reservations'::regclass,'terra_private.source_response_dispatches'::regclass,
 'terra_private.source_response_settlements'::regclass)),'All three ledgers have RLS enabled');
select ok(not has_table_privilege('terra_collector','terra_private.source_response_reservations','INSERT'),
 'Collector receives no arbitrary reservation insert');
select ok(not has_table_privilege('authenticated','terra_private.source_response_dispatches','INSERT'),
 'Ordinary user receives no dispatch write');
select ok(not has_table_privilege('terra_issue_reader','terra_private.source_response_settlements','SELECT'),
 'Public reader receives no private attempt history');
select ok(not has_function_privilege('service_role','terra_private.reserve_source_response(uuid,text,uuid,uuid,text,integer)','EXECUTE'),
 'Service role receives no reservation execution');
select ok(not has_function_privilege('terra_collector','terra_private.dispatch_source_response(uuid,text,uuid,uuid)','EXECUTE'),
 'Collector receives no dispatch execution');
select ok(not has_function_privilege('authenticated','terra_private.settle_source_response(uuid,text,uuid,uuid,text,integer,text)','EXECUTE'),
 'Ordinary user receives no settlement execution');
select is((select count(*) from pg_proc where pronamespace='terra_private'::regnamespace and
 proname in('response_reserved_charge','assert_response_capture','check_response_reservation',
 'check_response_dispatch','check_response_settlement','response_reservation_receipt',
 'reserve_source_response','dispatch_source_response','settle_source_response','check_response_source_check') and prosecdef),0::bigint,
 'All ten candidate functions preserve invoker authority');
set constraints all immediate;
select pass('Deferred capacity and current-source checks pass at transaction boundary');
select * from finish();
rollback;
