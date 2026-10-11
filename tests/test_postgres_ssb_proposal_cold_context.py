"""Fixed cold fixture context/request/import checks, no DB/Docker/network."""
from copy import deepcopy
from dataclasses import replace
import json, subprocess, sys, tempfile, unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from scripts import postgres_ssb_proposal_cold_child as child
from scripts.fictional_run_admission_cases import fictional_request
from workers.update_request_identity import canonical_update_request, identify_update_request


class SSBColdContextTests(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory();self.base=Path(self.directory.name)
        label='20261006000000_abcdef';target='terrafracta_pg_audit_'+label
        proof=self.base/('native-'+label)/'ssb-cold'/'recover'
        proof.mkdir(parents=True,mode=0o700)
        self.roles={'writer':'terra_ssb_writer_'+'b'*12,'reader':'terra_ssb_reader_'+'c'*12}
        certificate='-----BEGIN CERTIFICATE-----\nFixed public certificate\n'
        self.value={'containerId':'a'*64,'target':target,'volume':target+'_data','label':label,
            'database':'terra_pg_audit_trial','proof':str(proof),'mode':'recover','runId':'88220000-0000-4000-8000-000000000001'}
        for key in self.roles:
            self.value[key]={'host':'127.0.0.1','port':54321,'database':self.value['database'],
                'user':self.roles[key],'password':'fixed-fictional-password-with-no-account',
                'transport':{'kind':'verified-tls','ca':certificate}}
        (proof.parents[1]/'OWNED_IDENTITY.json').write_text(json.dumps({k:self.value[k] for k in ('containerId','target','volume','label')}))
        (proof.parents[1]/'TEST_CA.pem').write_text(certificate)
        (proof.parents[1]/'SSB_TRIAL_ROLES.json').write_text(json.dumps(self.roles))
        self.metadata={'Id':'a'*64,'Image':child.IMAGE,'Name':'/'+target,'Config':{'Labels':{'terrafracta.pg-audit':label}},
            'State':{'Running':True},'HostConfig':{'NetworkMode':'bridge','ReadonlyRootfs':True},
            'NetworkSettings':{'Ports':{'5432/tcp':[{'HostIp':'127.0.0.1','HostPort':'54321'}]}},
            'Mounts':[{'Name':target+'_data','Destination':'/trial'}]}

    def tearDown(self):self.directory.cleanup()

    def inspect(self,value,metadata=None):
        result=SimpleNamespace(returncode=0,stdout=json.dumps([metadata or self.metadata]))
        with patch.object(child,'BASE',self.base),patch.object(child.subprocess,'run',return_value=result) as inspect:
            returned=child.checked_context(value)
            self.assertEqual(inspect.call_count,1)
            self.assertEqual(inspect.call_args.args[0],['docker','inspect','a'*64])
            return returned

    def refused_before_inspection(self,value):
        with patch.object(child,'BASE',self.base),patch.object(child.subprocess,'run') as inspect:
            with self.assertRaises(AssertionError):child.checked_context(value)
            inspect.assert_not_called()

    def test_only_fixed_owned_context_reaches_identity_inspection(self):
        self.assertEqual(self.inspect(self.value),Path(self.value['proof']))

    def test_original_payload_report_fence_or_sql_cannot_be_supplied(self):
        for key in ('payload','report','response','captureId','manifest','work','sql','source'):
            value=deepcopy(self.value);value[key]='not-authority'
            self.refused_before_inspection(value)

    def test_location_mode_and_run_locator_remain_fixed(self):
        for key,other in (('database','postgres'),('target','retained_target'),('mode','publish'),
                ('runId','not-a-run'),('proof',str(self.base/'other'))):
            value=deepcopy(self.value);value[key]=other
            self.refused_before_inspection(value)
        Path(self.value['proof']).chmod(0o755)
        self.refused_before_inspection(self.value)

    def test_configuration_cannot_select_other_account_origin_or_transport(self):
        for key,other in (('host','remote.invalid'),('port',True),('database','postgres'),('user','postgres'),
                ('password','short'),('transport',{'kind':'loopback-development'})):
            value=deepcopy(self.value);value['writer'][key]=other
            self.refused_before_inspection(value)
        value=deepcopy(self.value);value['reader']['options']='untrusted'
        self.refused_before_inspection(value)

    def test_live_metadata_must_match_the_owned_volume_and_loopback_port(self):
        for key,other in (('Image','other-image'),('HostConfig',{'NetworkMode':'host','ReadonlyRootfs':True}),
                ('State',{'Running':False}),('Mounts',[{'Name':'other_volume','Destination':'/trial'}]),
                ('NetworkSettings',{'Ports':{'5432/tcp':[{'HostIp':'0.0.0.0','HostPort':'54321'}]}})):
            metadata=deepcopy(self.metadata);metadata[key]=other
            with self.assertRaises(AssertionError):self.inspect(self.value,metadata)

    def test_fixed_request_is_reconstructed_and_compared_exactly(self):
        original=fictional_request();key='fictional:ssb-private-proposal:'+'b'*12
        request=replace(original,request_key=key,policy_version='private-assessment-v1',
            limits=replace(original.limits,max_items=3,max_retries=0,max_response_bytes=2*65537))
        rows={'requestKey':key,'canonicalRequest':canonical_update_request(request),
            'requestFingerprint':identify_update_request(request).request_fingerprint}
        self.assertEqual(child.reload_request(rows),request)
        for field,other in (('requestKey','arbitrary-key'),('canonicalRequest',rows['canonicalRequest']+' '),
                ('requestFingerprint','a'*64)):
            changed=dict(rows);changed[field]=other
            with self.assertRaises(AssertionError):child.reload_request(changed)
        changed=replace(request,limits=replace(request.limits,max_retries=1))
        with self.assertRaises(AssertionError):child.reload_request({**rows,'canonicalRequest':canonical_update_request(changed)})

    def test_fresh_process_import_does_not_load_original_ssb_producer_or_fixture(self):
        code='import json,sys;import scripts.postgres_ssb_proposal_cold_child;print(json.dumps(dict(producer="workers.ssb_14059_private_proposal" in sys.modules,fixture="scripts.postgres_ssb_proposal_fixture" in sys.modules)))'
        result=subprocess.run([sys.executable,'-B','-E','-s','-c',code],cwd=child.ROOT,capture_output=True,text=True,timeout=10)
        self.assertEqual(result.returncode,0)
        self.assertEqual(json.loads(result.stdout),{'producer':False,'fixture':False})


if __name__=='__main__':unittest.main()
