"""New composed restore profile/custodian refusal checks; no Docker calls."""
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import Mock,patch
import unittest
from scripts.rehearse_complete_chain_restore import (validate_profile,RestoredView,SCHEMAS,TABLES,FUNCTIONS)
from scripts.rehearse_document_result_restore import OwnedRestoreDatabase
from scripts.rehearse_postgres_feed_journal import FeedPgTrialError


def profile():return {'schemas':list(SCHEMAS),'tables':list(TABLES),'functions':list(FUNCTIONS),'ownerSchemas':5,'ownerTables':7,'ownerFunctions':12,
 'definers':0,'otherFunctionGrants':0,'otherTableGrants':0,'otherSchemaGrants':0,'rlsTables':7}
def trial():return SimpleNamespace(suffix='20261015T103400Z-01234567',assertions=[],check=Mock(),record=Mock())
def target(parent):
 value=OwnedRestoreDatabase(parent);value.oid=16385;return value


class CompleteChainRestoreScopeTests(unittest.TestCase):
 def test_only_closed_owner_only_private_invoker_profile_is_accepted(self):
  self.assertEqual(validate_profile(profile()),profile())
  for key in ['ownerSchemas','ownerTables','ownerFunctions','rlsTables','definers','otherFunctionGrants','otherTableGrants','otherSchemaGrants']:
   for changed in [True,False,profile()[key]+1]:
    value=profile();value[key]=changed
    with self.assertRaises(FeedPgTrialError):validate_profile(value)

 def test_missing_extra_reordered_or_foreign_objects_cannot_be_no_owner_profile(self):
  for key in ['schemas','tables','functions']:
   for change in [lambda x:x.pop(),lambda x:x.append('foreign.object'),lambda x:x.reverse()]:
    value=profile();change(value[key])
    with self.assertRaises(FeedPgTrialError):validate_profile(value)
  for value in [{},None,{**profile(),'extra':0}]:
   with self.assertRaises(FeedPgTrialError):validate_profile(value)

 def test_foreign_custodian_same_oid_never_forwards_query(self):
  parent=trial();foreign=trial();database=target(foreign)
  self.assertEqual(database.oid,target(parent).oid)
  with self.assertRaises(FeedPgTrialError):RestoredView(parent,database)
  with self.assertRaises(FeedPgTrialError):RestoredView(parent,SimpleNamespace(trial=parent,oid=16385))

 def test_unbound_or_noninteger_oid_refuses_and_mutated_custodian_refuses_before_query(self):
  parent=trial();database=target(parent)
  for oid in [None,'16385',True]:
   database.oid=oid
   with self.assertRaises(FeedPgTrialError):RestoredView(parent,database)
  database.oid=16385;view=RestoredView(parent,database);database.trial=trial()
  with patch.object(database,'query') as query:
   with self.assertRaises(FeedPgTrialError):view.query('select 1;')
   query.assert_not_called()

 def test_same_custodian_facade_keeps_existing_owned_target_query_guard(self):
  parent=trial();database=target(parent);view=RestoredView(parent,database)
  with patch.object(database,'query',return_value='result') as query:
   self.assertEqual(view.query('select 1;',allowed=True),'result');query.assert_called_once_with('select 1;',allowed=True)
  view.check('bound',True);parent.check.assert_called_once_with('bound',True)
  self.assertIs(view.assertions,parent.assertions)

 def test_extra_arguments_refuse_before_custodian_construction(self):
  from scripts import rehearse_complete_chain_restore as module
  with patch.object(module.sys,'argv',['trial','existing']),patch.object(module,'FreshFeedPostgres') as constructor:
   with self.assertRaises(FeedPgTrialError):module.main()
   constructor.assert_not_called()

if __name__=='__main__':unittest.main()
