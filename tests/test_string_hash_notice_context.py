"""Actual invented packets and fixed shaped build/terms receipts; no legal gate."""
from copy import deepcopy
from hashlib import sha256
import json,unittest
from unittest.mock import patch
from scripts import compiled_notice_context as context
from scripts import prepare_local_web_candidate as candidate
from scripts.prepare_server_notice_bundle import _exclusive
from tests import test_artifact_notice_coverage as support


class StringHashNoticeContextTests(unittest.TestCase):
    def setUp(self):
        helper=support.ArtifactNoticeCoverageTests();helper.setUp();self.addCleanup(helper.doCleanups)
        self.root=helper.root;self.packet=helper.destination;self.upstream=self.packet.parent/'string-terms'
        self.upstream.mkdir(mode=0o700);self.original,self.shipped=helper.add_package('next',notice=False)
        for parent in (self.original,self.shipped):
            (parent/'package.json').write_text(json.dumps({'name':'next','version':'16.3.6','license':'MIT'}))
            folder=parent/'dist/compiled/string-hash';folder.mkdir(parents=True)
            (folder/'package.json').write_text(json.dumps({'name':'string-hash','license':'CC0-1.0','main':'index.js'}))
            (folder/'index.js').write_text('throw Error("IMPLEMENTATION_NEVER_EXECUTES")')
        self.definition={'schemaVersion':1,'kind':'fixed_next_string_hash_notice_candidates','observedAt':'2026-10-07T09:30:00+00:00',
            'nextCommit':'a758ffcf501f6f1ddb03175bd1033508424c261e','packageCommit':'5bf7547a91372c399f4052cc1094a93f73e10284',
            'nextBuildVersion':'1.1.3','compiledVersionObserved':False,'sources':[],'implementationCodeFetched':False,'archiveFetched':False,
            'codeExecuted':False,'dependenciesChanged':False,'packetChanged':False,'scopeBindingReviewed':False,'releaseCleared':False}
        nc=self.definition['nextCommit'];pc=self.definition['packageCommit']
        metadata={'name':'string-hash','version':'1.1.3','license':'CC0-1.0',
            'repository':{'type':'git','url':'git://github.com/darkskyapp/string-hash.git'}}
        readme=b'License\n-------\n\nTo the extend possible by law, The Dark Sky Company, LLC has [waived all\ncopyright and related or neighboring rights][cc0] to this library.\n\n[cc0]: http://creativecommons.org/publicdomain/zero/1.0/\n'
        receipts=[('next-package.json','https://raw.githubusercontent.com/vercel/next.js/'+nc+'/packages/next/package.json',
            {'name':'next','version':'16.3.6','license':'MIT','devDependencies':{'string-hash':'1.1.3'}}),
            ('string-hash-registry.json','https://registry.npmjs.org/string-hash/1.1.3',dict(metadata,gitHead=pc)),
            ('string-hash-package.json','https://raw.githubusercontent.com/darkskyapp/string-hash/'+pc+'/package.json',metadata),
            ('string-hash-README.md','https://raw.githubusercontent.com/darkskyapp/string-hash/'+pc+'/README.md',readme),
            ('CC0-1.0.txt','https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt',b'CC0 1.0 Universal\nInvented terms for local test; not acceptance.\n')]
        for saved,url,value in receipts:
            raw=value if type(value) is bytes else json.dumps(value).encode();_exclusive(self.upstream/saved,raw)
            self.definition['sources'].append({'savedFile':saved,'url':url,'bytes':len(raw),'sha256':sha256(raw).hexdigest(),
                'observedAt':'2026-10-07T09:25:00+00:00'})
        self.save();candidate.prepare_candidate(self.root,self.packet)

    def save(self):
        p=self.upstream/'RETRIEVAL.json';raw=json.dumps(self.definition).encode()
        if p.exists():p.write_bytes(raw)
        else:_exclusive(p,raw)

    def read(self):return context.read_string_hash_notice_context(self.packet,self.upstream)

    def replace(self,saved,value):
        raw=value if type(value) is bytes else json.dumps(value).encode();(self.upstream/saved).write_bytes(raw)
        row=next(row for row in self.definition['sources'] if row['savedFile']==saved)
        row.update(bytes=len(raw),sha256=sha256(raw).hexdigest());self.save()

    def test_build_version_and_standard_terms_do_not_authenticate_shipped_code(self):
        before=candidate.verify_candidate(self.packet)
        with patch('urllib.request.urlopen',side_effect=AssertionError('No network')):result=self.read()
        self.assertEqual(candidate.verify_candidate(self.packet),before)
        self.assertEqual(result['declaredNextBuildVersion'],'1.1.3');self.assertFalse(result['compiledVersionObserved'])
        self.assertEqual(len(result['shippedFileBindings']),2)
        self.assertEqual(result['originalCompiledNoticeGaps'],['node_modules/next/dist/compiled/string-hash'])
        self.assertEqual(result['originalPackageRootGaps'],['node_modules/next'])
        for key in ('actualCompiledVersionAuthenticated','upstreamAuthorshipAccepted','wholeCompiledScopeReviewed','packetChanged',
            'upstreamFetched','dependenciesExecuted','compiledScopeCleared','releaseCleared','obligationsReviewed','hostAccepted'):
            self.assertIs(result[key],False)
        self.assertNotIn('author',result);self.assertNotIn('repository',result)

    def test_top_schema_commits_version_promoted_flags_and_duplicate_keys_refuse(self):
        original=deepcopy(self.definition)
        for key,value in [('schemaVersion',True),('nextCommit','a'*40),('packageCommit','b'*40),('nextBuildVersion','1.1.4'),
            ('compiledVersionObserved',True),('releaseCleared',True),('scopeBindingReviewed',True),('codeExecuted',True),('extra',False)]:
            self.definition=deepcopy(original);self.definition[key]=value;self.save()
            with self.subTest(key=key),self.assertRaises(ValueError):self.read()
        self.definition=original;self.save();p=self.upstream/'RETRIEVAL.json'
        p.write_bytes(p.read_bytes().replace(b'"schemaVersion": 1',b'"schemaVersion": 1, "schemaVersion": 1'))
        with self.assertRaises(ValueError):self.read()

    def test_receipt_url_identity_type_date_extra_and_missing_source_refuse(self):
        original=deepcopy(self.definition)
        for key,value in [('url','https://foreign.invalid/terms'),('savedFile','../PRIVATE'),('bytes',True),
            ('observedAt','2026-10-07T10:00:00+00:00'),('observedAt','2026-10-07T09:25:00'),('observedAt',4),('unexpected',False)]:
            self.definition=deepcopy(original);self.definition['sources'][0][key]=value;self.save()
            with self.subTest(key=key),self.assertRaises(ValueError):self.read()
        self.definition=deepcopy(original);self.definition['sources'][1]=self.definition['sources'][0];self.save()
        with self.assertRaises(ValueError):self.read()

    def test_rehashed_metadata_cannot_supply_wrong_identity_commit_or_build_input(self):
        for saved in ('next-package.json','string-hash-registry.json','string-hash-package.json'):
            original=json.loads((self.upstream/saved).read_bytes())
            changes=[{'name':'foreign'},{'version':'other'},{'license':'other'}]
            changes+=([{'devDependencies':{'string-hash':'^1.1.3'}},{'devDependencies':{'string-hash':'1.1.4'}}] if saved=='next-package.json' else
                [{'repository':{'url':'git://github.com/foreign/repo.git'}}])
            if saved=='string-hash-registry.json':changes.append({'gitHead':'a'*40})
            for change in changes:
                self.replace(saved,dict(original,**change))
                with self.subTest(saved=saved,change=change),self.assertRaises(ValueError):self.read()
            self.replace(saved,original)

    def test_named_terms_without_the_selected_waiver_cannot_be_called_waiver_context(self):
        self.replace('string-hash-README.md',b'License\n-------\nNo waiver stated.\n[cc0]: http://creativecommons.org/publicdomain/zero/1.0/\n')
        with self.assertRaises(ValueError):self.read()

    def test_missing_terms_identity_and_waiver_reference_refuse(self):
        p=self.upstream/'CC0-1.0.txt';original=p.read_bytes();self.replace(p.name,b'CC0 different terms\n')
        with self.assertRaises(ValueError):self.read()
        self.replace(p.name,original)
        self.replace('string-hash-README.md',b'License\n-------\n[cc0]: https://foreign.invalid/\n')
        with self.assertRaises(ValueError):self.read()

    def test_private_permissions_links_oversize_and_bad_utf8_refuse_without_repair(self):
        p=self.upstream/'CC0-1.0.txt';original=p.read_bytes()
        for raw in (b'\xff',b'x'*16385,b'PRIVATE_CHANGED'):
            p.write_bytes(raw)
            with self.assertRaises(ValueError) as error:self.read()
            self.assertNotIn('PRIVATE_CHANGED',str(error.exception));self.assertEqual(p.read_bytes(),raw)
        p.write_bytes(original);p.chmod(0o644)
        with self.assertRaises(ValueError):self.read()
        p.chmod(0o600);p.unlink();p.symlink_to(self.upstream/'string-hash-README.md')
        with self.assertRaises(ValueError):self.read()

    def test_packet_drift_and_present_compiled_version_cannot_be_relabelled_absent(self):
        p=self.packet/'node_modules/next/dist/compiled/string-hash/index.js';raw=p.read_bytes();p.write_bytes(b'PRIVATE_CHANGED')
        with self.assertRaises(ValueError):self.read()
        p.write_bytes(raw)
        for parent in (self.original,self.shipped):
            p=parent/'dist/compiled/string-hash/package.json';value=json.loads(p.read_bytes());value['version']='1.1.3';p.write_text(json.dumps(value))
        self.packet=self.packet.parent/'version-observed-packet';candidate.prepare_candidate(self.root,self.packet)
        with self.assertRaises(ValueError):self.read()

    def test_changed_source_receipt_or_manifest_during_read_refuse(self):
        read=context.private_read;target=self.upstream/'CC0-1.0.txt';original=target.read_bytes();done=False
        def changed(path,**kwargs):
            nonlocal done
            raw=read(path,**kwargs)
            if path==target and not done:done=True;target.write_bytes(b'Changed during read')
            return raw
        with patch.object(context,'private_read',side_effect=changed),self.assertRaises(ValueError):self.read()
        target.write_bytes(original);done=False;manifest=self.upstream/'RETRIEVAL.json'
        def manifest_changed(path,**kwargs):
            nonlocal done
            raw=read(path,**kwargs)
            if path==manifest and not done:done=True;manifest.write_bytes(raw+b' ')
            return raw
        with patch.object(context,'private_read',side_effect=manifest_changed),self.assertRaises(ValueError):self.read()


if __name__=='__main__':unittest.main()
