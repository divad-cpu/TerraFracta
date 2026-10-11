"""Real C driver output boundary through a fake port; zero actual Docker/Node."""
from contextlib import redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'scripts/check_contact_free_write_node_native.py'

class ClosedChildOutput(unittest.TestCase):
    def probe(self, stdout, code=0):
        spec=importlib.util.spec_from_file_location('invented_child_output_boundary',SOURCE)
        module=importlib.util.module_from_spec(spec)
        with patch.object(sys,'path',[str(SOURCE.parent),*sys.path]):spec.loader.exec_module(module)
        calls=[];ownership={};inspections=0
        def fake(args,**kwargs):
            nonlocal inspections
            self.assertEqual(kwargs['env'],{'PATH':'/usr/bin:/bin'})
            if args[0]=='docker':
                self.assertEqual(args[:3],['docker','--host','unix:///var/run/docker.sock']);plain=[args[0],*args[3:]]
            else:plain=args
            calls.append(plain)
            if plain[:3]==['docker','image','inspect']:return subprocess.CompletedProcess(args,0,json.dumps(module.IMAGE),'')
            if plain[:3]==['docker','container','inspect']:return subprocess.CompletedProcess(args,1,'','No such invented object')
            if plain[:2]==['docker','run']:
                label=plain[plain.index('--label')+1].split('=',1)
                mount=plain[plain.index('--mount')+1].split('source=',1)[1].split(',',1)[0]
                ownership.update(image=module.IMAGE,labels={label[0]:label[1]},network='none',ports={},mounts=[{'Source':mount,'Destination':'/trial'}],running=False)
                return subprocess.CompletedProcess(args,0,'invented-ack','')
            if plain[:2]==['docker','inspect']:
                inspections+=1
                keys=['image','labels','network','ports','mounts'] if inspections==1 else ['image','labels','running']
                return subprocess.CompletedProcess(args,0,json.dumps({k:ownership[k] for k in keys}),'')
            if plain[0].endswith('/node'):return subprocess.CompletedProcess(args,code,stdout,'INVENTED_PRIVATE_STDERR_CANARY')
            if plain[:2]==['docker','exec']:return subprocess.CompletedProcess(args,0,'','')
            raise AssertionError('Unexpected synthetic command')
        captured=io.StringIO()
        with patch.object(sys,'argv',['invented-child-output']),patch.object(module.subprocess,'run',side_effect=fake),redirect_stdout(captured):
            with self.assertRaises((AssertionError,RuntimeError)):module.main()
        summary=json.loads(captured.getvalue());proof=Path(summary['privateEvidenceDirectory'])
        (proof/'SYNTHETIC_FAULT_PROBE.json').write_text(json.dumps({'syntheticOnly':True,'actualDockerCommands':0,'source':str(SOURCE),'proof':str(proof),'fault':'untrusted_child_stdout','interceptedCommands':len(calls)},indent=2)+'\n')
        self.assertFalse(json.loads((proof/'RESULT.json').read_text())['completed'])
        self.assertFalse((proof/'NODE_OBSERVATION.json').exists())
        self.assertFalse((proof/'NODE_RESULT.json').exists())
        for p in [proof/'RESULT.json',*proof.glob('*-command.json')]:
            self.assertNotIn('CANARY',p.read_text())
        node_receipts=[json.loads(p.read_text()) for p in proof.glob('*-command.json') if json.loads(p.read_text())['command'][0].endswith('/node')]
        self.assertEqual(len(node_receipts),1)
        self.assertFalse(node_receipts[0]['outputRetained']);self.assertEqual(node_receipts[0]['stdout'],'')
    def test_successful_malformed_and_private_child_stdout_is_not_durable(self):
        for text in ['INVENTED_PRIVATE_CANARY','{"completed":true,"failureLabel":"INVENTED_PRIVATE_CANARY"}', '["INVENTED_PRIVATE_CANARY"]','{"schemaVersion":1,"schemaVersion":1,"details":"INVENTED_PRIVATE_CANARY"}']:
            with self.subTest(shape=text[:12]):self.probe(text)
    def test_failed_child_output_is_not_durable(self):
        self.probe('INVENTED_PRIVATE_CANARY',1)
    def test_large_successful_child_output_is_not_durable(self):
        self.probe('INVENTED_PRIVATE_CANARY'+'x'*131072)
if __name__=='__main__':unittest.main()
