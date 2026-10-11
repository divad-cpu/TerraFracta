"""Actual sealed bytes and pre-import refusal, without HTTP or a database."""
from hashlib import sha256
from io import BytesIO
import json
import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import time
import unittest
from zipfile import ZIP_STORED, ZipFile

from tests.frozen_ssb_support import frozen_at, invented_bodies, snapshot_at
from scripts.freeze_ssb_source import freeze_fixture_source
from workers.bounded_worker_process import communicate_bounded
from workers.ssb_frozen_source import FrozenSSBSource, check_sealed, seal_source, child_command
from workers.ssb_14059_pair_transport import _decode_capture


class FrozenSourceTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)/'source'

    def source(self):
        source = frozen_at(self.root)
        self.addCleanup(source.close)
        return source

    def transport(self, source, *, command_changes=None):
        command = child_command('metadata', source, context_sha256='a'*64, parent_pid=os.getpid())
        if command_changes:
            command_changes(command)
        process = subprocess.Popen(command, cwd='/', env={}, pass_fds=(source.descriptor,), close_fds=True,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        packet = json.dumps({'kind': 'metadata', 'deadline': time.monotonic()+5, 'parentPid': os.getpid()}).encode()
        return communicate_bounded(process, packet, timeout=5, max_stdout=100000)

    def test_actual_seals_block_writes_growth_and_truncation(self):
        descriptor, digest = seal_source(b'bounded invented source')
        self.addCleanup(os.close, descriptor)
        for operation in (lambda: os.pwrite(descriptor, b'changed', 0),
                          lambda: os.ftruncate(descriptor, 0), lambda: os.ftruncate(descriptor, 999)):
            with self.assertRaises(OSError):
                operation()
        self.assertEqual(check_sealed(descriptor, digest), b'bounded invented source')
        self.assertFalse(os.get_inheritable(descriptor))

    def test_unsealed_regular_file_wrong_hash_and_invalid_descriptors_refuse(self):
        file = Path(self.temp.name)/'ordinary'
        file.write_bytes(b'not sealed')
        with file.open('rb') as stream:
            with self.assertRaises(ValueError):
                check_sealed(stream.fileno(), sha256(file.read_bytes()).hexdigest())
        source = self.source()
        for descriptor, digest in ((True, source.archive_sha256), (0, source.archive_sha256),
                                  (source.descriptor, '0'*64), (source.descriptor, 'A'*64)):
            with self.subTest(descriptor=descriptor, digest=digest), self.assertRaises(ValueError):
                check_sealed(descriptor, digest)

    def test_exact_source_and_fixed_invented_bodies_reopen_without_workspace(self):
        source = self.source()
        with ZipFile(BytesIO(source.check())) as archive:
            manifest = archive.read('MANIFEST.json')
            self.assertEqual(sha256(manifest).hexdigest(), source.source_fingerprint)
        # Alter the mutable snapshot after freezing: actual child must execute
        # the reviewed memory copy and return the original invented response.
        (self.root/'workers/__init__.py').write_text('raise RuntimeError("mutable-source-canary")\n')
        output = self.transport(source)
        self.assertEqual(output.returncode, 0, output.stderr)
        self.assertEqual(output.stderr, b'')
        self.assertEqual(_decode_capture('metadata', output.stdout).body, invented_bodies()['metadata'])
        self.assertFalse(list(self.root.rglob('__pycache__')))

    def test_changed_candidate_before_freeze_refuses_without_initialization(self):
        pin = snapshot_at(self.root)
        (self.root/'workers/__init__.py').write_text('raise RuntimeError("candidate-initialization-canary")\n')
        with self.assertRaisesRegex(ValueError, 'bytes changed'):
            freeze_fixture_source(self.root, pin, invented_bodies())

    def test_changed_archive_member_refuses_before_candidate_import(self):
        source = self.source()
        changed = BytesIO()
        with ZipFile(BytesIO(source.check())) as original, ZipFile(changed, 'w', compression=ZIP_STORED) as target:
            for name in original.namelist():
                target.writestr(name, b'raise RuntimeError("archive-initialization-canary")\n'
                                if name == 'workers/__init__.py' else original.read(name))
        descriptor, digest = seal_source(changed.getvalue())
        altered = FrozenSSBSource(descriptor, digest, source.source_fingerprint, source.source_files)
        self.addCleanup(altered.close)
        output = self.transport(altered)
        self.assertEqual((output.returncode, output.stdout, output.stderr),
                         (1, b'', b'Frozen private SSB worker refused the operation.\n'))

    def test_source_pin_and_hash_substitution_refuse_before_import(self):
        source = self.source()
        for index in (8, 9):
            output = self.transport(source, command_changes=lambda argv, index=index: argv.__setitem__(index, '0'*64))
            self.assertEqual(output.returncode, 1)
            self.assertEqual(output.stdout, b'')
            self.assertEqual(output.stderr, b'Frozen private SSB worker refused the operation.\n')

    def test_actual_executing_interpreter_must_match_pinned_binary(self):
        source = self.source()
        # Owned test copy only. ELF permits trailing bytes: the interpreter
        # reports the same version but its actual executable identity differs.
        copy = Path(self.temp.name)/'different-python'
        copy.write_bytes(Path('/usr/bin/python3.12').read_bytes()+b'\nprivate-test-extra-bytes\n')
        copy.chmod(0o700)
        output = self.transport(source, command_changes=lambda argv: argv.__setitem__(0, str(copy)))
        self.assertEqual((output.returncode, output.stdout, output.stderr),
                         (1, b'', b'Frozen private SSB worker refused the operation.\n'))

    def test_kind_and_capability_selectors_cannot_be_built(self):
        source = self.source()
        for kind, channel in (('other', -1), ('metadata', 9), ('worker', -1), ('worker', source.descriptor)):
            with self.subTest(kind=kind, channel=channel), self.assertRaises(ValueError):
                child_command(kind, source, channel=channel, context_sha256='a'*64, parent_pid=os.getpid())


if __name__ == '__main__':
    unittest.main()
