from hashlib import sha256
from pathlib import Path
import re
import unittest
from scripts.build_fictional_publication_api import build_publication_api
from scripts.build_fictional_publication_api_v2 import build_publication_api_v2
ROOT=Path(__file__).resolve().parents[1]
class PublicationScopeRevisionTests(unittest.TestCase):
    def test_original_proof_candidate_is_preserved_and_revision_is_literal(self):
        original=build_publication_api().encode()
        self.assertEqual(sha256(original).hexdigest(),'8deed741466900f4096021c087c9289056d089133f51ddb8206bcfe67aa628ff')
        self.assertEqual(original,(ROOT/'research/pending/TF009_fictional_publication_api.sql').read_bytes())
        self.assertEqual(build_publication_api_v2(),(ROOT/'research/pending/TF009_fictional_publication_api_v2.sql').read_text())
    def test_scope_serialization_preserves_the_entire_permission_and_identity_boundary(self):
        before=build_publication_api();after=build_publication_api_v2()
        header,body=after.split('\n',1)
        self.assertEqual(body.replace('principal=session_user for no key update;','principal=session_user for share;'),before)
        self.assertEqual(len(re.findall(r'^create function ',body,re.M)),20)
        self.assertIn("system_user is distinct from 'scram-sha-256:'||session_user::text",body)
        self.assertNotRegex(body.lower(),r'grant (?:execute|insert|update|delete|all)|create role ')
if __name__=='__main__':unittest.main()
