"""Expanded private-profile recovery scope; no native resources or replay."""
from copy import deepcopy
import json
from types import SimpleNamespace
import unittest
from unittest.mock import Mock,patch
from scripts.rehearse_stream_reader import validate_profile,FeedPgTrialError
from scripts.rehearse_stream_reader_restore import whole_dump_scope


def acl(privileges,readers=(),*,schema=False):
 rows=[dict(grantor='tf_feed_lab_owner',grantee='tf_feed_lab_owner',privilege=p,grantable=False) for p in privileges]
 return rows+[dict(grantor='tf_feed_lab_owner',grantee=r,privilege='USAGE' if schema else 'EXECUTE',grantable=False) for r in readers]


def good():
 schemas=['tf_document_reopen','tf_feed_inventory','tf_feed_rehearsal','tf_feed_reopen','tf_feed_runtime','tf_feed_windows']
 tables=sorted(['tf_feed_rehearsal.'+x for x in ['streams','pages','items','outcomes','document_results']]+['tf_feed_windows.collections','tf_feed_windows.windows','tf_feed_runtime.allowed_streams','tf_feed_runtime.allowed_collections'])
 functions=sorted(['tf_document_reopen.original','tf_feed_inventory.page','tf_feed_reopen.original']+['tf_feed_rehearsal.'+x for x in ['capture','page_receipt','record_outcome','complete_document_result','document_result_receipt']]+['tf_feed_windows.'+x for x in ['advance','head','initialize','receipt']]+['tf_feed_runtime.'+x for x in ['require_stream','capture','complete_document_result','page_receipt','document_result_receipt','collection_inventory','feed_original','document_original','item_history']])
 readers=('tf_feed_lab_writer','tf_feed_lab_observer');result={'schemas':[],'tables':[],'functions':[]}
 for name in schemas:
  result['schemas'].append(dict(name=name,owner='tf_feed_lab_owner',writerUsage=name=='tf_feed_runtime',observerUsage=name=='tf_feed_runtime',acl=acl(['CREATE','USAGE'],readers if name=='tf_feed_runtime' else (),schema=True),otherGrants=0))
 for name in tables:result['tables'].append(dict(name=name,owner='tf_feed_lab_owner',rls=True,acl=acl(['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']),otherGrants=0))
 for name in functions:
  runtime=name.startswith('tf_feed_runtime.');method=name.split('.')[1]
  write=runtime and method!='require_stream';read=write and method not in ['capture','complete_document_result']
  result['functions'].append(dict(name=name,owner='tf_feed_lab_owner',definer=write,path=['search_path=pg_catalog, pg_temp'],writer=write,observer=read,acl=acl(['EXECUTE'],readers if read else readers[:1] if write else ()),otherGrants=0))
 return result


class StreamReaderProfileTests(unittest.TestCase):
 def test_exact_six_schema_nine_table_twenty_one_function_profile(self):
  value=good();self.assertIs(validate_profile(value),value)
  self.assertEqual([len(value[k]) for k in ['schemas','tables','functions']],[6,9,21])

 def test_owner_rls_definer_path_membership_or_grants_drift_refuses(self):
  mutations=[lambda v:v['schemas'].pop(),lambda v:v['tables'].pop(),lambda v:v['functions'].pop(),
   lambda v:v['schemas'][0].update(owner='postgres'),lambda v:v['tables'][0].update(rls=False),
   lambda v:v['functions'][0].update(definer=True),lambda v:v['functions'][0].update(path=['public']),
   lambda v:v['functions'][0].update(observer=True),lambda v:v['schemas'][0].update(otherGrants=1),
   lambda v:v['functions'][0]['acl'][0].update(grantable=True),lambda v:v['tables'][0]['acl'][0].update(grantor='postgres'),
   lambda v:v['schemas'][4]['acl'].append(dict(grantor='tf_feed_lab_owner',grantee='tf_feed_lab_writer',privilege='CREATE',grantable=False))]
  for mutate in mutations:
   value=good();mutate(value)
   with self.assertRaises(FeedPgTrialError):validate_profile(value)

 def test_equal_bool_integer_and_extra_keys_refuse(self):
  for kind,key,bad in [('schemas','otherGrants',False),('tables','rls',1),('functions','definer',0)]:
   value=good();value[kind][0][key]=bad
   with self.assertRaises(FeedPgTrialError):validate_profile(value)
  value=good();value['functions'][0]['acl'][0]['grantable']=0
  with self.assertRaises(FeedPgTrialError):validate_profile(value)
  value=good();value['tables'][0]['extra']='unknown'
  with self.assertRaises(FeedPgTrialError):validate_profile(value)

 def test_whole_dump_guard_requires_exact_new_scope_and_empty_public(self):
  value=dict(schemas=['public',*[s['name'] for s in good()['schemas']]],publicRelations=0,publicFunctions=0,extensions=['plpgsql'],tables=9)
  query=Mock(return_value=SimpleNamespace(stdout=json.dumps(value).encode()))
  self.assertEqual(whole_dump_scope(query),value)
  for key,bad in [('schemas',value['schemas']+['foreign']),('publicRelations',1),('publicFunctions',1),('extensions',['plpgsql','foreign']),('tables',8),('publicFunctions',False)]:
   with self.subTest(key=key):
    query.return_value.stdout=json.dumps({**value,key:bad}).encode()
    with self.assertRaises(FeedPgTrialError):whole_dump_scope(query)

 def test_complete_default_acl_rejects_extra_writer_grant_or_grant_option(self):
  from scripts.rehearse_stream_reader_restore import private_defaults
  summary=dict(explicitEntries=1,publicExecute=0)
  entries=[dict(owner='tf_feed_lab_owner',schema='<global>',type='f',acl=acl(['EXECUTE']))]
  def run(value):
   query=Mock(side_effect=[SimpleNamespace(stdout=json.dumps(summary).encode()),SimpleNamespace(stdout=json.dumps(value).encode())])
   return private_defaults(query)
  self.assertEqual(run(entries),dict(summary=summary,entries=entries))
  for mutate in [lambda v:v[0]['acl'].append(dict(grantor='tf_feed_lab_owner',grantee='tf_feed_lab_writer',privilege='EXECUTE',grantable=False)),
   lambda v:v[0]['acl'][0].update(grantable=True),lambda v:v[0].update(schema='tf_feed_runtime'),lambda v:v.append(deepcopy(v[0]))]:
   value=deepcopy(entries);mutate(value)
   with self.assertRaises(FeedPgTrialError):run(value)

 def test_restore_takes_no_target_arguments_or_resources(self):
  from scripts import rehearse_stream_reader_restore as module
  with patch.object(module.sys,'argv',['trial','existing-target']),patch.object(module,'FreshFeedPostgres') as constructor:
   with self.assertRaises(FeedPgTrialError):module.main()
   constructor.assert_not_called()

 def test_failed_restore_still_stops_both_owned_resources(self):
  from scripts import rehearse_stream_reader_restore as module
  trial=Mock();trial.identity='owned';events=[]
  trial.stop.side_effect=lambda:events.append('stop');trial.stop_initializer.side_effect=lambda:events.append('initializer')
  trial.verify_sources.side_effect=lambda label:events.append(label);trial.inspect.side_effect=lambda:events.append('inspect') or {'owned':True}
  with patch.object(module.sys,'argv',['trial']),patch.object(module,'FreshFeedPostgres',return_value=trial),patch.object(module,'freeze_all'),patch.object(module,'freeze_stream_restore'),patch.object(module,'cases',side_effect=RuntimeError('invented')):
   with self.assertRaises(RuntimeError):module.main()
  self.assertEqual(events,['stop','initializer','FINAL_STREAM_RESTORE','inspect'])
  self.assertTrue(any(c.args[0]=='STREAM_RESTORE_FAILED' for c in trial.record.call_args_list))


if __name__=='__main__':unittest.main()
