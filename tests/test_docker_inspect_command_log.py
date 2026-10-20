import json
import unittest
from types import SimpleNamespace
from scripts.docker_inspect_command_log import docker_inspect_log_record


class NoOutput:
    returncode = 0
    @property
    def stdout(self):
        raise AssertionError('Inspect stdout was observed')
    @property
    def stderr(self):
        raise AssertionError('Inspect stderr was observed')


class DockerInspectCommandLogTests(unittest.TestCase):
    def test_supported_inspect_commands_never_observe_output_or_target_values(self):
        for executable in ('docker', '/usr/bin/docker'):
            for prefix, kind in ((['inspect'], 'object'), (['container', 'inspect'], 'container'),
                                 (['volume', 'inspect'], 'volume'), (['image', 'inspect'], 'image')):
                command = [executable, *prefix, 'FICTIONAL_TARGET_CANARY']
                body = docker_inspect_log_record(command, NoOutput())
                self.assertNotIn('FICTIONAL_TARGET_CANARY', body)
                self.assertEqual(json.loads(body), {
                    'evidenceKind': 'docker_inspect_command_result', 'objectKind': kind,
                    'exitCode': 0, 'stdoutRetained': False, 'stderrRetained': False,
                    'metadataRetained': False})
    def test_output_format_and_error_content_cannot_enter_a_closed_record(self):
        for stdout in ('not JSON FICTIONAL_STDOUT_CANARY', '[{"Config":{"Cmd":["FICTIONAL_COMMAND_CANARY"]}}]',
                       '[{}]\nFICTIONAL_TRAILER_CANARY', b'\xffFICTIONAL_BINARY_CANARY'):
            response = SimpleNamespace(returncode=1, stdout=stdout, stderr='FICTIONAL_STDERR_CANARY')
            body = docker_inspect_log_record(['docker', 'container', 'inspect', 'fictional'], response)
            self.assertNotIn('FICTIONAL_', body)
            self.assertEqual(json.loads(body)['exitCode'], 1)
            self.assertEqual(response.stdout, stdout)
    def test_noninspect_commands_do_not_read_the_result_or_claim_output_is_safe(self):
        class Unobserved:
            @property
            def returncode(self):
                raise AssertionError('Noninspect result inspected')
        for command in ([], ['docker'], ['docker', 'exec', 'fictional', 'inspect'],
                        ['docker', 'logs', 'fictional'], ['supabase', 'inspect'],
                        ['not-docker', 'inspect'], ['docker', '--context', 'fictional', 'inspect'],
                        ['docker', 'container', 'ls'], ['docker', None], 'docker inspect'):
            self.assertIsNone(docker_inspect_log_record(command, Unobserved()))
    def test_invalid_exit_status_is_null_without_raw_output_fallback_or_coercion(self):
        class PrivateStatus:
            def __str__(self):
                raise AssertionError('Status coercion')
        for code in (True, None, 256, -257, 'FICTIONAL_STATUS_CANARY', PrivateStatus()):
            response = NoOutput()
            response.returncode = code
            result = json.loads(docker_inspect_log_record(['docker', 'inspect'], response))
            self.assertIsNone(result['exitCode'])
            self.assertFalse(result['stdoutRetained'])
    def test_status_access_failure_keeps_the_diagnostic_closed(self):
        class FailedStatus(NoOutput):
            @property
            def returncode(self):
                raise RuntimeError('FICTIONAL_STATUS_CANARY')
        body = docker_inspect_log_record(['docker', 'volume', 'inspect'], FailedStatus())
        self.assertIsNone(json.loads(body)['exitCode'])
        self.assertNotIn('FICTIONAL_STATUS_CANARY', body)
    def test_valid_signed_exit_codes_remain_exact(self):
        for code in (-256, -15, -1, 0, 1, 125, 127, 255):
            response = NoOutput()
            response.returncode = code
            self.assertEqual(json.loads(docker_inspect_log_record(['docker', 'image', 'inspect'], response))['exitCode'], code)


if __name__ == '__main__':
    unittest.main()
