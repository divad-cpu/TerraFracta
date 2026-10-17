"""Fixed typed metadata route; existing inventory parser remains unchanged."""
from dataclasses import replace
from unittest.mock import patch
import unittest
from tests.test_feed_collection_inventory import SCOPE,CUT
from workers.feed_collection_inventory import prepare_inventory_request,FeedInventoryError,InventoryCursor
from workers.feed_collection_reader import restricted_inventory_statement


class FeedCollectionReaderTests(unittest.TestCase):
 def test_only_outer_fixed_identifier_changes_and_exact_context_survives(self):
  for request in [prepare_inventory_request(SCOPE),prepare_inventory_request(SCOPE,cut=CUT,after=InventoryCursor(1,1,1))]:
   original=request.statement();actual=restricted_inventory_statement(request)
   self.assertEqual(actual,original.replace('select tf_feed_inventory.page(','select tf_feed_runtime.collection_inventory(',1))
   self.assertIn('repeatable read read only',actual)
   self.assertEqual(actual.count('select tf_feed_runtime.collection_inventory('),1)

 def test_free_sql_untyped_and_forged_mutable_requests_refuse(self):
  request=prepare_inventory_request(SCOPE)
  for bad in [None,'select anything();',{},replace(request,canonical_input=b'{}'),replace(request,canonical_input=bytearray(request.canonical_input))]:
   with self.assertRaises(FeedInventoryError):restricted_inventory_statement(bad)

 def test_exact_generated_route_and_final_encoded_limit_are_required(self):
  request=prepare_inventory_request(SCOPE)
  with patch('workers.feed_collection_reader.MAX_INVENTORY_STATEMENT',1):
   with self.assertRaises(FeedInventoryError):restricted_inventory_statement(request)
  with patch.object(type(request),'statement',return_value='select anything();'):
   with self.assertRaises(FeedInventoryError):restricted_inventory_statement(request)


class CollectionReaderInstallScopeTests(unittest.TestCase):
 def test_foreign_or_fake_role_custodian_refuses_before_any_install(self):
  from types import SimpleNamespace
  from unittest.mock import Mock
  from scripts.rehearse_collection_reader import install_reader
  from scripts.rehearse_feed_runtime_roles import OwnedRuntimeRoles
  from scripts.rehearse_postgres_feed_journal import FeedPgTrialError
  parent=SimpleNamespace(query=Mock());foreign=SimpleNamespace(query=Mock())
  for roles in [OwnedRuntimeRoles(foreign),SimpleNamespace(trial=parent)]:
   with self.assertRaises(FeedPgTrialError):install_reader(parent,roles)
  parent.query.assert_not_called();foreign.query.assert_not_called()

 def test_only_frozen_overlay_runs_between_exact_role_verifications(self):
  from types import SimpleNamespace
  from unittest.mock import Mock
  from scripts.rehearse_collection_reader import install_reader,FIXTURE
  from scripts.rehearse_feed_runtime_roles import OwnedRuntimeRoles
  events=[];parent=SimpleNamespace(frozen={FIXTURE:b'-- invented overlay'},query=Mock(side_effect=lambda sql:events.append(sql)))
  roles=OwnedRuntimeRoles(parent);roles.verify=Mock(side_effect=lambda:events.append('verify'))
  install_reader(parent,roles)
  self.assertEqual(events,['verify',"begin;set local statement_timeout='10s';-- invented overlaycommit;",'verify'])

if __name__=='__main__':unittest.main()
