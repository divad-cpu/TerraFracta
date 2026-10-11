"""Closed composition and preflight; no socket, database or source connection."""
import base64
from dataclasses import asdict
from datetime import timedelta
import json
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from tests import test_reserved_ssb_capture as support
from tests import test_ssb_pair_processing as pair_support
from workers.closed_ssb_worker import parse_closed_ssb_context, process_closed_ssb_context
from workers.update_run_completion import parse_canonical_run_manifest


def packet():
    m,d=support.contexts()
    return {'request':asdict(m.invocation),'work':asdict(m.work),
        'responses':{kind:{'registration_id':req.registration_id,'request_key':req.request_key}
                     for kind,req in (('metadata',m),('data',d))},
        'versions':{'metadata':pair_support.META,'data':pair_support.DATA},
        'pairId':pair_support.PAIR,'principal':support.PRINCIPAL}


def wire(value):
    return json.dumps(value,default=str,separators=(',',':')).encode()


class ClosedContextTests(unittest.TestCase):
    def parse(self,value):return parse_closed_ssb_context(wire(value),now=support.NOW)

    def test_context_has_fixed_urls_and_immutable_distinct_identities(self):
        result=self.parse(packet())
        self.assertEqual((result.metadata,result.data),support.contexts())
        self.assertEqual(result.pair_id,pair_support.PAIR)
        with self.assertRaises(AttributeError):result.pair_id=pair_support.META

    def test_selectors_or_extra_authority_are_rejected_before_any_call(self):
        for field in ('sql','role','transaction','endpoint','rawPath','transport','credentials','schedule'):
            value=packet();value[field]='private-canary'
            client,fetch=Mock(),Mock()
            with self.subTest(field=field),self.assertRaisesRegex(ValueError,'Invalid closed'):
                process_closed_ssb_context(wire(value),client,fetch,utc_now=lambda:support.NOW)
            client.call.assert_not_called();fetch.assert_not_called()

    def test_version_pair_principal_and_registration_substitutions_fail_preflight(self):
        variants=[]
        for key,value in (('pairId',True),('pairId','AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'),('principal',''),
                          ('principal','postgres;select'),('principal',True)):
            p=packet();p[key]=value;variants.append(p)
        p=packet();p['versions']['data']=p['versions']['metadata'];variants.append(p)
        p=packet();p['versions']['metadata']='bad';variants.append(p)
        p=packet();p['responses']['data']['registration_id']=p['responses']['metadata']['registration_id'];variants.append(p)
        p=packet();p['responses']['data']['request_key']=p['responses']['metadata']['request_key'];variants.append(p)
        for value in variants:
            with self.subTest(value=value),self.assertRaises(ValueError):self.parse(value)

    def test_budget_and_publish_mode_cannot_reach_channel(self):
        for change in ({'mode':'publish_eligible'},{'limits':{**packet()['request']['limits'],'max_response_bytes':131073}},
                       {'limits':{**packet()['request']['limits'],'run_cap_usd':False}},
                       {'limits':{**packet()['request']['limits'],'month_cap_usd':'NaN'}}):
            p=packet();p['request'].update(change)
            client,fetch=Mock(),Mock()
            with self.subTest(change=change),self.assertRaises(ValueError):
                process_closed_ssb_context(wire(p),client,fetch,utc_now=lambda:support.NOW)
            client.call.assert_not_called();fetch.assert_not_called()

    def test_work_attempt_type_expiry_and_impossible_windows_are_held(self):
        for change in ({'attempt':True},{'attempt':0},{'attempt':7},{'status':'finished'},
                       {'lease_id':None},{'observed_at':support.NOW+timedelta(seconds=1)},
                       {'lease_expires_at':support.NOW},{'lease_expires_at':support.NOW+timedelta(seconds=31)},
                       {'deadline_at':support.NOW+timedelta(seconds=301)},
                       {'lease_expires_at':support.NOW+timedelta(seconds=29),'deadline_at':support.NOW+timedelta(seconds=28)},
                       {'observed_at':support.NOW.replace(tzinfo=None)}):
            p=packet();p['work'].update(change)
            with self.subTest(change=change),self.assertRaises(ValueError):self.parse(p)

    def test_duplicate_nonfinite_oversize_and_container_substitution_are_held(self):
        valid=wire(packet())
        for raw in (valid[:-1]+b',"principal":"duplicate"}',b'\xff',b'[]',b'x'*16385,
                    b'{"principal":NaN}',b'['*2000):
            with self.subTest(size=len(raw)),self.assertRaises(ValueError):
                parse_closed_ssb_context(raw,now=support.NOW)
        for name in ('request','work','responses','versions'):
            p=packet();p[name]=[]
            with self.subTest(name=name),self.assertRaises(ValueError):self.parse(p)


class ClosedCompositionTests(unittest.TestCase):
    def setUp(self):
        self.shared=support.ReservedSSBTests();self.shared.setUp()
        self.pending=pair_support.Backend();self.calls=[];self.receipts={};self.states={}
        self.client=SimpleNamespace(call=self.call)
        self.contexts=dict(zip(('metadata','data'),support.contexts(),strict=True))
        self.ledgers={kind:support.Ledger(req,self.shared.events) for kind,req in self.contexts.items()}
        self.confirmers={kind:support.Confirmer(req,self.shared.events) for kind,req in self.contexts.items()}

    def call(self,operation,args):
        self.calls.append(operation)
        if operation in ('reserve_response','dispatch_response','settle_response','confirm_response'):
            kind=args['kind'];req=self.contexts[kind];ledger=self.ledgers[kind]
            if operation=='reserve_response':
                raw=ledger.reserve(req)
                from workers.source_response_receipts import parse_response_reservation
                self.states[kind]=parse_response_reservation(raw,req,now=support.NOW)
                return raw
            if operation=='dispatch_response':return ledger.dispatch(req,self.states[kind])
            if operation=='settle_response':return ledger.settle(req,self.states[kind],outcome=args['outcome'],
                body_bytes=args['bodyBytes'],content_sha256=args['contentSha256'])
            return self.confirmers[kind].confirm(args['phase'],base64.b64decode(args['receipt'],validate=True))
        if operation=='store_pair':
            self.paired=SimpleNamespace(manifest=parse_canonical_run_manifest(args['manifest'].encode()))
            self.receipts['read_pair_checkpoint']=self.pending.store_pair(self.paired,None,None)
            return b'{"stored":true}'
        if operation=='close_processing':
            self.receipts['read_closeout']=self.pending.close_pair(self.paired)
            return b'{"closed":true}'
        return self.receipts[operation]

    def run_worker(self):
        return process_closed_ssb_context(wire(packet()),self.client,self.shared.fetch,
            utc_now=lambda:support.NOW,monotonic=lambda:self.shared.ticks)

    def test_exact_sixteen_operations_and_dispatch_confirmations_precede_fetch(self):
        result=self.run_worker()
        self.assertEqual(len(self.calls),16)
        self.assertEqual(self.calls[-4:],['store_pair','read_pair_checkpoint','close_processing','read_closeout'])
        self.assertEqual(result.checkpoint,self.receipts['read_pair_checkpoint'])
        self.assertEqual(result.closeout,self.receipts['read_closeout'])
        self.assertEqual(result.pending.closeout.summary.run_state,'partial')
        for kind,req in self.contexts.items():
            self.assertLess(self.shared.events.index((req.request_key,'confirm:dispatch')),
                            self.shared.events.index((kind,'fetch')))

    def test_denied_dispatch_never_opens_source_or_stores_pair(self):
        self.confirmers['metadata'].fail='dispatch'
        with self.assertRaises(ValueError):self.run_worker()
        self.assertNotIn('store_pair',self.calls)
        self.assertFalse(any(event[1]=='fetch' for event in self.shared.events))
        self.assertEqual(self.calls,['reserve_response','confirm_response','dispatch_response','confirm_response'])

    def test_existing_dispatch_prevents_automatic_refetch(self):
        self.ledgers['metadata'].dispatched=True
        with self.assertRaises(ValueError):self.run_worker()
        self.assertFalse(any(event[1]=='fetch' for event in self.shared.events))
        self.assertNotIn('store_pair',self.calls)

    def test_ambiguous_store_stops_before_close_and_never_refetches(self):
        self.pending.fail_store=True
        with self.assertRaises(ValueError):self.run_worker()
        with self.assertRaises(ValueError):self.run_worker()
        self.assertEqual(self.calls.count('store_pair'),1)
        self.assertEqual(len([e for e in self.shared.events if e[1]=='fetch']),2)
        self.assertNotIn('close_processing',self.calls)

    def test_forged_pending_receipt_never_closes_processing(self):
        self.pending.alter=lambda p:p.update(validationState='usable')
        with self.assertRaises(ValueError):self.run_worker()
        self.assertNotIn('close_processing',self.calls)


if __name__=='__main__':unittest.main()
