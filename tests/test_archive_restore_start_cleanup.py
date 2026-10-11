"""Lost start acknowledgements must still stop the exact new restore clone."""
from contextlib import ExitStack
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from scripts import check_closed_worker_archive_restore as restore


class ArchiveRestoreStartCleanupTests(unittest.TestCase):
    def scenario(self,fault='lost_ack'):
        calls=[];running=False;identity='d'*64
        with TemporaryDirectory() as scratch,ExitStack() as stack:
            root=Path(scratch);archive=root/'archive';archive.mkdir();proof=root/'proof'
            record={'volumes':[{'target':restore.SOURCE,'archive':'fixture.tar.gz','archiveSha256':'a'*64,'checksumSha256':'a'*64,'regularFilesVerified':1}]}
            (archive/'CONNECTED_PRESERVATION_RESULT.json').write_text(json.dumps(record))
            stack.enter_context(patch.object(restore,'ARCHIVE',archive));stack.enter_context(patch.object(restore,'PROOF',proof))
            stack.enter_context(patch.object(restore,'digest_file',return_value='a'*64))
            stack.enter_context(patch.object(restore.sys,'argv',['fixed-restore']))
            def run(args,**kwargs):
                nonlocal running
                calls.append(args)
                if args[:3] in (['docker','container','inspect'],['docker','volume','inspect']):return SimpleNamespace(returncode=1,stdout='',stderr='')
                if args[:2]==['docker','create']:return SimpleNamespace(returncode=0,stdout=identity+'\n',stderr='')
                if args[:2]==['docker','inspect']:
                    label,value=restore.RECOVERY_LABEL.split('=',1)
                    metadata={'name':'/'+restore.TARGET,'id':identity,'image':restore.IMAGE,'labels':{label:value},'running':running,'network':'none','ports':{}}
                    if fault=='wrong_identity':metadata['id']='e'*64
                    return SimpleNamespace(returncode=0,stdout=json.dumps(metadata),stderr='')
                if args[:2]==['docker','start'] or args[:3]==['docker','run','--detach']:
                    running=True
                    if fault=='interrupt':raise KeyboardInterrupt()
                    if fault=='nonzero_ack':return SimpleNamespace(returncode=1,stdout='',stderr='')
                    raise OSError('Invented lost restore start acknowledgement')
                if args[:2]==['docker','stop']:
                    if fault!='stop_unconfirmed':running=False
                    return SimpleNamespace(returncode=0,stdout='',stderr='')
                text='./fixture: OK\n' if '--workdir' in args else ''
                return SimpleNamespace(returncode=0,stdout=text,stderr='')
            stack.enter_context(patch.object(restore.subprocess,'run',side_effect=run))
            if fault=='identity_sync':stack.enter_context(patch.object(restore.os,'fsync',side_effect=OSError('Invented identity sync refusal')))
            with self.assertRaises((OSError,RuntimeError,KeyboardInterrupt,ValueError,AssertionError)):
                restore.main()
            failure=json.loads((proof/'RESTORE_FAILURE.json').read_text())
            self.assertFalse(failure['primaryChanged'])
            return calls,running,{p.name:p.read_bytes() for p in proof.iterdir()}

    def test_lost_ack_interrupt_and_nonzero_ack_always_stop_after_start_attempt(self):
        for fault in ('lost_ack','interrupt','nonzero_ack'):
            with self.subTest(fault=fault):
                calls,running,_=self.scenario(fault)
                self.assertFalse(running)
                self.assertEqual([c for c in calls if c[:2]==['docker','stop']],[['docker','stop','--timeout','10','d'*64]])

    def test_unconfirmed_stop_is_a_failure_not_a_stopped_acceptance(self):
        calls,running,files=self.scenario('stop_unconfirmed')
        self.assertTrue(running);self.assertTrue(any(c[:2]==['docker','stop'] for c in calls))
        self.assertIn('RESTORE_STOP_FAILURE.json',files)
        self.assertNotIn('CLOSED_WORKER_RESTORE_RESULT.json',files)

    def test_invalid_identity_or_failed_durable_record_refuses_before_start(self):
        for fault in ('wrong_identity','identity_sync'):
            with self.subTest(fault=fault):
                calls,running,files=self.scenario(fault)
                self.assertFalse(running);self.assertFalse(any(c[:2]==['docker','start'] for c in calls))
                self.assertNotIn('CLOSED_WORKER_RESTORE_RESULT.json',files)


if __name__=='__main__':unittest.main()
