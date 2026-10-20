"""Actual bounded CLI processes over invented private files; never source acquisition."""
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from workers.document_passage_binding import (DocumentByteSpan, PlainDocumentReceipt,
    DocumentPassageBinding, DocumentSpanMap, bind_document_passages)

ROOT=Path(__file__).resolve().parents[1]
COMMAND=ROOT/'scripts/prepare_document_quote.py'


class DocumentQuoteCommandProcessTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='tf-quote-command-process-');self.addCleanup(self.temp.cleanup)
        self.folder=Path(self.temp.name)
        self.original=self.folder/'FICTIONAL_PRIVATE_ORIGINAL.txt';self.quote=self.folder/'FICTIONAL_PRIVATE_QUOTE.txt'
        self.files('Å\r\nx Å'.encode(), 'Å'.encode())

    def files(self, raw, quote):
        for p,data in [(self.original,raw),(self.quote,quote)]:
            fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
            with os.fdopen(fd,'wb') as f:f.write(data)
        self.digest=sha256(raw).hexdigest()

    def args(self, mode='locate'):
        return [mode,'--original',str(self.original),'--quote',str(self.quote),
                '--expected-original-sha256',self.digest,'--locator','section:one']

    def run_command(self,args):
        return subprocess.run([sys.executable,'-B','-m','scripts.prepare_document_quote',*args],cwd=ROOT,
                              stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=5,check=False)

    def refused(self,args):
        result=self.run_command(args);self.assertEqual(result.returncode,2)
        self.assertEqual(result.stdout,b'');self.assertEqual(result.stderr,b'document_quote_preparation_refused\n')
        return result

    def test_actual_locate_returns_complete_compact_sorted_existing_span_fields(self):
        result=self.run_command(self.args());self.assertEqual(result.returncode,0);self.assertEqual(result.stderr,b'')
        self.assertEqual(result.stdout,b'[{"end":2,"locator":"section:one","start":0},{"end":8,"locator":"section:one","start":6}]\n')
        self.assertNotIn('Å'.encode(), result.stdout)
        self.assertNotIn(str(self.folder).encode(), result.stdout)
        self.assertNotIn(self.digest.encode(), result.stdout)

    def test_actual_explicit_second_choice_roundtrips_to_existing_binder(self):
        result=self.run_command(self.args('choose')+['--occurrence-number','2'])
        self.assertEqual(result.returncode,0);self.assertEqual(result.stderr,b'')
        self.assertEqual(result.stdout,b'{"end":8,"locator":"section:one","start":6}\n')
        raw=self.original.read_bytes();span=DocumentByteSpan(**json.loads(result.stdout));at=datetime(2026,10,20,tzinfo=timezone.utc)
        document=PlainDocumentReceipt('fictional-source','item','document-version','https://example.org/original.txt',self.digest,at)
        binding=DocumentPassageBinding(document.source_key,document.item_key,document.source_version_id,
            document.source_url,self.digest,'a'*64,'nb',at)
        mapping=DocumentSpanMap(document.source_version_id,self.digest,'a'*64,'nb',(span,))
        actual=bind_document_passages(raw,document,binding=binding,mapping=mapping,observed_at=at+timedelta(seconds=1))
        self.assertEqual(actual.snapshot.passages[0].text,'Å');self.assertEqual(actual.spans,(span,))
        self.assertEqual(actual.evidence_state,'offline_original_document_bytes_bound_only')

    def test_actual_bom_crlf_and_overlapping_positions_are_exact(self):
        for raw,quote,positions in [(b'\xef\xbb\xbfA\r\nA',b'A',[(3,4),(6,7)]),
                                    (b'aaa',b'aa',[(0,2),(1,3)])]:
            self.files(raw,quote);result=self.run_command(self.args());self.assertEqual(result.returncode,0)
            self.assertEqual([(x['start'],x['end']) for x in json.loads(result.stdout)],positions)
            self.assertEqual(result.stderr,b'')

    def test_actual_zero_matches_are_success_but_choice_is_refused(self):
        self.files(b'Original',b'absent');result=self.run_command(self.args())
        self.assertEqual((result.returncode,result.stdout,result.stderr),(0,b'[]\n',b''))
        self.refused(self.args('choose')+['--occurrence-number','1'])

    def test_actual_hash_and_utf8_refusals_have_no_private_echo(self):
        args=self.args();args[6]='0'*64;self.refused(args)
        self.files(b'FICTIONAL_PRIVATE_SOURCE\xff',b'FICTIONAL_PRIVATE_SOURCE');self.refused(self.args())
        self.files(b'FICTIONAL_PRIVATE_SOURCE',b'\xff');self.refused(self.args())

    def test_actual_empty_size_and_candidate_caps_refuse_without_partial_json(self):
        for raw,quote in [(b'',b'q'),(b'q',b''),(b'q',b' '),(b'q'*65537,b'q'),
                          (b'q'*8193,b'q'*8193),(b'q'*129,b'q')]:
            self.files(raw,quote);self.refused(self.args())
        self.files(b'q'*128,b'q');result=self.run_command(self.args());self.assertEqual(result.returncode,0)
        self.assertEqual(len(json.loads(result.stdout)),128)

    def test_actual_final_symlinks_directory_and_fifo_refuse_without_blocking(self):
        saved=self.folder/'saved';self.original.rename(saved);self.original.symlink_to(saved)
        self.refused(self.args());self.original.unlink();self.original.mkdir();self.refused(self.args());self.original.rmdir()
        os.mkfifo(self.original,0o600);self.refused(self.args());self.original.unlink();saved.rename(self.original)
        saved_quote=self.folder/'saved_quote';self.quote.rename(saved_quote);self.quote.symlink_to(saved_quote);self.refused(self.args())

    def test_actual_help_and_invalid_arguments_do_not_echo_user_tokens(self):
        result=self.run_command(['--help']);self.assertEqual(result.returncode,0);self.assertEqual(result.stdout,b'');self.assertTrue(result.stderr)
        self.refused(['FICTIONAL_PRIVATE_ARGUMENT'])
        self.refused(self.args('choose'))
        self.refused(self.args()+['--occurrence-number','1'])


if __name__=='__main__':unittest.main()
