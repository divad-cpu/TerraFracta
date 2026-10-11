"""Invented packet connections and actual locked parser, without target execution."""
from copy import deepcopy
from hashlib import sha256
import json,subprocess,unittest
from unittest.mock import patch
from scripts import compiled_notice_context as context
from scripts import prepare_local_web_candidate as candidate
from scripts.prepare_server_notice_bundle import _exclusive
from tests import test_artifact_notice_coverage as support

TASK=b'''export async function ncc_image_detector(task, opts) {
  await task.source(relative(__dirname, require.resolve('image-size/dist/detector.js')))
    .ncc({ packageName: 'image-size', externals }).target('src/compiled/image-detector')
}
'''


class ImageTaskSyntaxTests(unittest.TestCase):
    def test_actual_parser_reads_static_task_without_executing_input(self):
        source=b'process.exit(99); throw Error("NEVER_EXECUTE");\n'+TASK
        result=context._image_task_syntax(source)
        self.assertEqual(result['inputPackageSubpath'],'image-size/dist/detector.js')
        self.assertTrue(result['syntaxOnly']);self.assertFalse(result['executedBindingsAuthenticated'])
        # Whitespace/comments and literal escapes are syntax, not an execution.
        self.assertEqual(context._image_task_syntax(TASK.replace(b'await task',b'await /* retained note */ task')
            .replace(b'image-size/dist/detector.js',b'image-size/dist/detector\\x2ejs')),result)

    def test_comments_strings_nested_functions_and_duplicate_tasks_cannot_supply_top_task(self):
        for source in (b'// '+TASK.replace(b'\n',b'\n// '),b'const x='+json.dumps(TASK.decode()).encode()+b';',
            b'const x=`'+TASK+b'`;',b'function outer(){'+TASK.replace(b'export ',b'')+b'}',TASK+TASK):
            with self.subTest(source=source[:40]),self.assertRaises(ValueError):context._image_task_syntax(source)

    def test_dynamic_optional_computed_foreign_and_extra_task_shapes_refuse(self):
        variants=[(b'async function',b'function'),(b'(task, opts)',b'(task = execute(), opts)'),
            (b'(task, opts)',b'(foreign, opts)'),(b'await task.',b'await foreign.'),
            (b'.source(',b'["source"]('),(b'.source(',b'?.source('),
            (b'relative(__dirname',b'foreign(__dirname'),(b'__dirname',b'other_directory'),
            (b'require.resolve',b'foreign.resolve'),(b'require.resolve(',b'require.resolve?.('),
            (b"'image-size/dist/detector.js'",b'choose_input()'),(b"'image-size/dist/detector.js'",b"'foreign/input.js'"),
            (b"packageName: 'image-size', externals",b"packageName: 'image-size', externals, ...override"),
            (b"packageName: 'image-size', externals",b"packageName: 'image-size', packageName: 'foreign'"),
            (b"packageName: 'image-size', externals",b"packageName: 'image-size', externals: foreign"),
            (b"'src/compiled/image-detector'",b"'src/compiled/other'"),
            (b".target('src/compiled/image-detector')",b".target('src/compiled/image-detector').then(run)"),
            (b'\n}',b'; execute();\n}'),(b'\n}',b'\n')]
        for old,new in variants:
            with self.subTest(change=new),self.assertRaises(ValueError):context._image_task_syntax(TASK.replace(old,new))

    def test_invalid_utf8_and_actual_byte_bounds_refuse(self):
        for source in (b'\xff'+TASK,b'/*'+b'x'*262144+b'*/'+TASK,b'/*'+('é'*131072).encode()+b'*/'+TASK):
            with self.subTest(bytes=len(source)),self.assertRaises(ValueError):context._image_task_syntax(source)

    def test_wrapper_contains_tool_failures_and_excludes_inherited_node_options(self):
        with patch.object(subprocess,'run',return_value=subprocess.CompletedProcess([],0,b'{}',b'PRIVATE')) as run:
            with self.assertRaises(ValueError):context._image_task_syntax(TASK)
            self.assertEqual(run.call_args.kwargs['env'],{'NODE_ENV':'production'})
            self.assertIs(run.call_args.kwargs['stderr'],subprocess.DEVNULL)
            self.assertEqual(run.call_args.kwargs['timeout'],5)
        for returned in (subprocess.CompletedProcess([],1,b'PRIVATE',b'PRIVATE'),
            subprocess.CompletedProcess([],0,b'x'*4097,b'')):
            with patch.object(subprocess,'run',return_value=returned),self.assertRaises(ValueError):context._image_task_syntax(TASK)


class ImageDetectorNoticeContextTests(unittest.TestCase):
    def setUp(self):
        helper=support.ArtifactNoticeCoverageTests();helper.setUp();self.addCleanup(helper.doCleanups)
        self.root=helper.root;self.packet=helper.destination;self.next=self.packet.parent/'next-definition';self.next.mkdir(mode=0o700)
        self.upstream=self.packet.parent/'image-context';self.upstream.mkdir(mode=0o700)
        self.original,self.shipped=helper.add_package('next',notice=False)
        self.terms=b'Invented complete MIT notice; test data, not legal acceptance.\n'
        for parent in (self.original,self.shipped):
            (parent/'package.json').write_text(json.dumps({'name':'next','version':'16.3.6','license':'MIT'}))
            detector=parent/'dist/compiled/image-detector';detector.mkdir(parents=True)
            (detector/'detector.js').write_text('throw Error("SHIPPED_IMPLEMENTATION_NEVER_EXECUTES")')
            image=parent/'dist/compiled/image-size';image.mkdir()
            (image/'index.js').write_text('throw Error("SHIPPED_IMAGE_SIZE_NEVER_EXECUTES")')
        (self.original/'dist/compiled/image-size/LICENSE').write_bytes(self.terms)
        nc='a758ffcf501f6f1ddb03175bd1033508424c261e';pc='a4178fbb334ddb22d94cb4228ed597c24fd02e10'
        self.definition={'schemaVersion':1,'kind':'fixed_next_image_detector_notice_context','observedAt':'2026-10-07T10:00:00+00:00',
            'nextCommit':nc,'packageCommit':pc,'nextBuildVersion':'1.2.1','nextDefinition':None,'sources':[],
            'upstreamBuildSourceFetched':True,'upstreamBuildSourceExecuted':False,'upstreamPackageImplementationFetched':False,
            'archiveFetched':False,'dependenciesChanged':False,'packetChanged':False,'scopeBindingReviewed':False,'releaseCleared':False}
        metadata={'name':'image-size','version':'1.2.1','license':'MIT','repository':'git://github.com/image-size/image-size.git'}
        inputs=[(self.next,'next-package.json','https://raw.githubusercontent.com/vercel/next.js/'+nc+'/packages/next/package.json',
            {'name':'next','version':'16.3.6','license':'MIT','devDependencies':{'image-size':'1.2.1'}}),
            (self.upstream,'next-taskfile.js.source.txt','https://raw.githubusercontent.com/vercel/next.js/'+nc+'/packages/next/taskfile.js',TASK),
            (self.upstream,'image-size-registry.json','https://registry.npmjs.org/image-size/1.2.1',dict(metadata,gitHead=pc)),
            (self.upstream,'image-size-package.json','https://raw.githubusercontent.com/image-size/image-size/'+pc+'/package.json',metadata),
            (self.upstream,'image-size-LICENSE','https://raw.githubusercontent.com/image-size/image-size/'+pc+'/LICENSE',self.terms)]
        for directory,saved,url,value in inputs:
            raw=value if type(value) is bytes else json.dumps(value).encode();_exclusive(directory/saved,raw)
            row={'savedFile':saved,'url':url,'bytes':len(raw),'sha256':sha256(raw).hexdigest(),'observedAt':'2026-10-07T09:50:00+00:00'}
            if directory==self.next:self.definition['nextDefinition']=row
            else:self.definition['sources'].append(row)
        self.save();candidate.prepare_candidate(self.root,self.packet)

    def save(self):
        p=self.upstream/'RETRIEVAL.json';raw=json.dumps(self.definition).encode()
        if p.exists():p.write_bytes(raw)
        else:_exclusive(p,raw)

    def read(self):return context.read_image_detector_notice_context(self.packet,self.next,self.upstream)

    def replace(self,saved,value):
        raw=value if type(value) is bytes else json.dumps(value).encode();directory=self.next if saved=='next-package.json' else self.upstream
        (directory/saved).write_bytes(raw)
        row=self.definition['nextDefinition'] if saved=='next-package.json' else next(row for row in self.definition['sources'] if row['savedFile']==saved)
        row.update(bytes=len(raw),sha256=sha256(raw).hexdigest());self.save()

    def test_actual_packet_task_notice_connection_preserves_version_and_all_holds(self):
        before=candidate.verify_candidate(self.packet)
        with patch('urllib.request.urlopen',side_effect=AssertionError('No network')):r=self.read()
        self.assertEqual(candidate.verify_candidate(self.packet),before)
        self.assertEqual(r['declaredNextBuildPackage'],'image-size');self.assertEqual(r['declaredNextBuildVersion'],'1.2.1')
        self.assertEqual(r['noticeText'],self.terms.decode());self.assertEqual(len(r['shippedFileBindings']),1)
        self.assertTrue(r['existingNoticePath'].endswith('/dist/compiled/image-size/LICENSE'))
        self.assertEqual(r['originalCompiledNoticeGaps'],['node_modules/next/dist/compiled/image-detector'])
        self.assertEqual(r['originalPackageRootGaps'],['node_modules/next'])
        for key in ('compiledVersionObserved','actualCompiledVersionAuthenticated','executedBuildBindingsAuthenticated',
            'upstreamAuthorshipAccepted','wholeCompiledScopeReviewed','upstreamBuildProgramExecuted','packetChanged',
            'upstreamFetched','dependenciesExecuted','compiledScopeCleared','releaseCleared','obligationsReviewed','hostAccepted'):
            self.assertIs(r[key],False)
        self.assertTrue(r['retainedBuildSourceFetched']);self.assertTrue(r['parserToolExecuted']);self.assertNotIn('author',r)

    def test_schema_commits_versions_promoted_flags_and_duplicate_keys_refuse(self):
        original=deepcopy(self.definition)
        changes=[('schemaVersion',True),('nextCommit','a'*40),('packageCommit','b'*40),('nextBuildVersion','^1.2.1'),
            ('upstreamBuildSourceFetched',1),('upstreamBuildSourceExecuted',True),('scopeBindingReviewed',True),('releaseCleared',True),('extra',False)]
        for key,value in changes:
            self.definition=deepcopy(original);self.definition[key]=value;self.save()
            with self.subTest(key=key),self.assertRaises(ValueError):self.read()
        self.definition=original;self.save();p=self.upstream/'RETRIEVAL.json'
        p.write_bytes(p.read_bytes().replace(b'"schemaVersion": 1',b'"schemaVersion": 1, "schemaVersion": 1'))
        with self.assertRaises(ValueError):self.read()

    def test_wrong_receipt_paths_urls_types_dates_or_missing_sources_refuse(self):
        original=deepcopy(self.definition)
        for target in ('sources','nextDefinition'):
            for key,value in [('url','https://foreign.invalid/private'),('savedFile','../PRIVATE'),('savedFile',[]),
                ('bytes',True),('observedAt','2026-10-07T11:00:00+00:00'),('observedAt','2026-10-07T09:50:00'),('extra',False)]:
                self.definition=deepcopy(original);row=self.definition[target][0] if target=='sources' else self.definition[target]
                row[key]=value;self.save()
                with self.subTest(target=target,key=key),self.assertRaises(ValueError):self.read()
        self.definition=deepcopy(original);self.definition['sources'][1]=self.definition['sources'][0];self.save()
        with self.assertRaises(ValueError):self.read()

    def test_rehashed_metadata_cannot_reassign_build_package_version_repository_or_commit(self):
        for saved in ('next-package.json','image-size-registry.json','image-size-package.json'):
            directory=self.next if saved=='next-package.json' else self.upstream;original=json.loads((directory/saved).read_bytes())
            changes=[{'name':'foreign'},{'version':'other'},{'license':'other'}]
            changes+=([{'devDependencies':{'image-size':'^1.2.1'}},{'devDependencies':None}] if saved=='next-package.json' else
                [{'repository':'git://github.com/foreign/repo.git'},{'repository':[]}])
            if saved=='image-size-registry.json':changes.append({'gitHead':'a'*40})
            for change in changes:
                self.replace(saved,dict(original,**change))
                with self.subTest(saved=saved,change=change),self.assertRaises(ValueError):self.read()
            self.replace(saved,original)

    def test_rehashed_wrong_task_and_terms_cannot_attach_existing_notice(self):
        self.replace('next-taskfile.js.source.txt',TASK.replace(b'image-size/dist/detector.js',b'foreign/detector.js'))
        with self.assertRaises(ValueError):self.read()
        self.replace('next-taskfile.js.source.txt',TASK);self.replace('image-size-LICENSE',b'Different retained terms')
        with self.assertRaises(ValueError):self.read()

    def test_private_permissions_links_bad_bytes_and_packet_drift_refuse_without_repair(self):
        p=self.upstream/'image-size-LICENSE';original=p.read_bytes()
        for raw in (b'\xff',b'x'*16385,b'PRIVATE_CHANGED'):
            p.write_bytes(raw)
            with self.assertRaises(ValueError) as error:self.read()
            self.assertNotIn('PRIVATE_CHANGED',str(error.exception));self.assertEqual(p.read_bytes(),raw)
        p.write_bytes(original);p.chmod(0o644)
        with self.assertRaises(ValueError):self.read()
        p.chmod(0o600);p.unlink();p.symlink_to(self.upstream/'image-size-package.json')
        with self.assertRaises(ValueError):self.read()
        p.unlink();_exclusive(p,original)
        p=self.packet/'node_modules/next/dist/compiled/image-detector/detector.js';p.write_bytes(b'PRIVATE_CHANGED')
        with self.assertRaises(ValueError):self.read()
        self.assertEqual(p.read_bytes(),b'PRIVATE_CHANGED')

    def test_added_compiled_metadata_is_not_relabelled_as_absent(self):
        for parent in (self.original,self.shipped):
            (parent/'dist/compiled/image-detector/package.json').write_text('{"name":"image-size","version":"1.2.1","license":"MIT"}')
        self.packet=self.packet.parent/'different-packet';candidate.prepare_candidate(self.root,self.packet)
        with self.assertRaises(ValueError):self.read()

    def test_source_descriptor_or_packet_manifest_changes_during_read_refuse(self):
        read=context.private_read
        for target in (self.upstream/'next-taskfile.js.source.txt',self.next/'next-package.json',self.upstream/'RETRIEVAL.json',
            self.packet/candidate.MANIFEST):
            original=target.read_bytes();done=False
            def changed(path,**kwargs):
                nonlocal done
                raw=read(path,**kwargs)
                if path==target and not done:done=True;target.write_bytes(raw+b' ')
                return raw
            with self.subTest(target=target.name),patch.object(context,'private_read',side_effect=changed),self.assertRaises(ValueError):self.read()
            target.write_bytes(original)

    def test_parser_timeout_failure_is_private_and_cannot_change_packet(self):
        before=candidate.verify_candidate(self.packet)
        with patch.object(subprocess,'run',side_effect=subprocess.TimeoutExpired('PRIVATE_COMMAND',5)):
            with self.assertRaises(ValueError) as error:self.read()
            self.assertNotIn('PRIVATE',str(error.exception))
        self.assertEqual(candidate.verify_candidate(self.packet),before)


if __name__=='__main__':unittest.main()
