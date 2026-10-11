"""Discover the new invented SSB captures through existing operator surfaces.

Parses actual shipped SSR links and GET fields with stdlib HTMLParser; no browser
or HTTP interaction. Stored running/source states do not establish current health.
"""
from html.parser import HTMLParser
from urllib.parse import urlsplit, parse_qsl
import json


class Navigation(HTMLParser):
    def __init__(self,html):
        super().__init__(convert_charrefs=True);self.links=[];self.forms=[];self.current=None;self.select=None
        self.feed(html);self.close()
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='a' and 'href' in a:self.links.append(a['href'])
        if tag=='form':
            assert self.current is None
            self.current={'method':a.get('method','get').lower(),'action':a.get('action'),'fields':{}}
            self.forms.append(self.current)
        if self.current is not None and tag=='input' and 'name' in a:self.field(a['name'],a.get('value',''))
        if self.current is not None and tag=='select':self.select=a.get('name')
        if self.current is not None and tag=='option' and self.select is not None:self.field(self.select,a['value'])
    def field(self,name,value):
        assert name not in self.current['fields']
        self.current['fields'][name]=value
    def handle_endtag(self,tag):
        if tag=='select':self.select=None
        if tag=='form':self.current=None


def exact_link(href,path,keys):
    parsed=urlsplit(href)
    assert not parsed.scheme and not parsed.netloc and not parsed.fragment and parsed.path==path
    pairs=parse_qsl(parsed.query,strict_parsing=True,keep_blank_values=True)
    assert len(pairs)==len(dict(pairs)) and set(dict(pairs))==set(keys)
    return dict(pairs)


def selected_link(navigation,path,expected):
    matched=[]
    for href in navigation.links:
        parsed=urlsplit(href)
        if not parsed.scheme and not parsed.netloc and parsed.path==path and parsed.query:
            fields=exact_link(href,path,expected)
            if fields==expected:matched.append(fields)
    assert matched
    return matched[0]


def inspect_ssb_operator_flow(owner,node,configuration,run_id,issue_id,versions,captures):
    counts_sql="select jsonb_build_object('captures',(select count(*) from terra_private.proposal_captures),'decisions',(select count(*) from terra_private.machine_candidate_decisions),'sourceVersions',(select count(*) from terra_private.source_versions),'pairs',(select count(*) from terra_private.source_response_pairs),'pendingValidations',(select count(*) from terra_private.source_pair_validations where validation_state='pending'),'usableValidations',(select count(*) from terra_private.source_pair_validations where validation_state='usable'),'manifestItems',(select jsonb_array_length(canonical_manifest::jsonb->'items') from terra_private.update_run_manifests),'closeouts',(select count(*) from terra_private.update_run_closeouts),'publications',(select count(*) from terra_private.issue_publications));"
    before=json.loads(owner(counts_sql,'ssb-operator-counts-before'))
    pages=[]
    def read(name,mode,scope):
        result=node('ssb-operator-'+name,'scripts/check_postgres_ssb_operator_native.mjs',
            {'configuration':configuration,'mode':mode,'scope':scope})
        assert result['drained'] is True and result['diagnostics']==[] and result['decision']['kind']=='ok'
        pages.append({'name':name,**result['presentation']})
        return result['decision']['report'],Navigation(result['html'])
    runs,nav=read('runs','choices',None)
    assert len(runs['runs'])==1 and runs['runs'][0]['runId']==run_id and runs['runs'][0]['runState']=='running'
    assert runs['selectedRun'] is None and runs['issues']==[]
    selected=selected_link(nav,'/editorial-preview/audit/select',{'runId':run_id})
    choices,nav=read('selected','choices',selected['runId'])
    assert choices['selectedRun']==runs['runs'][0] and choices['issues']==[{'issueId':issue_id,'issueKey':'invented-housing'}]
    forms=[f for f in nav.forms if f['action']=='/editorial-preview/audit']
    assert len(forms)==1 and forms[0]['method']=='get' and forms[0]['fields']=={'runId':run_id,'issueId':issue_id}
    audit,_=read('audit','audit',{**forms[0]['fields'],'cursor':None})
    assert audit['run']['mode']=='shadow' and audit['run']['runState']=='running' and audit['run']['commitState']=='none'
    assert audit['run']['visibilityState']=='not_required' and audit['run']['finishedAt'] is None
    assert audit['expectedSourcesKnown'] is True
    assert {s['sourceKey'] for s in audit['sources']}=={'ssb-14059-metadata','ssb-14059-data'}
    assert all(s['outcome']=='captured' and s['sourceVersionId']==versions[s['sourceKey'].removeprefix('ssb-14059-')] for s in audit['sources'])
    assert audit['history']['latestRevision']==0 and audit['history']['headPublicationId'] is None and audit['history']['publications']==[] and audit['history']['nextCursor'] is None
    held_scope=selected_link(nav,'/editorial-preview/held',{'runId':run_id})
    held,queue=read('held','held',{**held_scope,'cursor':None})
    assert len(held['decisions'])==2 and held['more'] is False and held['nextCursor'] is None
    selected_link(queue,'/editorial-preview/audit/select',{'runId':run_id})
    expected_captures={capture['captureId']:capture for capture in captures}
    discovered=[]
    for decision in held['decisions']:
        assert decision['sourceKey']=='ssb-14059-data' and decision['qualificationDecision']=='suspended'
        assert all(value is None for value in decision['checks'].values())
        proposal_scope=selected_link(queue,'/editorial-preview/held/proposal',{'runId':run_id,'decisionId':decision['decisionId']})
        proposal,comparison=read(decision['decisionId'],'proposal',proposal_scope)
        assert proposal['capture']==expected_captures[proposal['capture']['captureId']] and proposal['target']['issueId']==issue_id
        assert proposal['base'] is None and len(proposal['sourceReceipts'])==2
        payload=json.loads(proposal['capture']['proposalJson'])
        assert payload['dependencyManifest']['sourceVersionIds']==[versions['data'],versions['metadata']]
        assert payload['translation']=={'displayLanguage':'en','status':'unreviewed'} and payload['conflictCoverage']=='not_recorded'
        selected_link(comparison,'/editorial-preview/held',{'runId':run_id})
        assert '/editorial-preview/audit/select' in comparison.links
        discovered.append({'decisionId':decision['decisionId'],'captureId':proposal['capture']['captureId']})
    after=json.loads(owner(counts_sql,'ssb-operator-counts-after'))
    assert after==before and after['captures']==2 and after['manifestItems']==3 and after['pendingValidations']==1 and after['usableValidations']==after['closeouts']==after['publications']==0
    return {'pages':pages,'discovered':discovered,'countsBefore':before,'countsAfter':after,
        'storedRunState':'running','selectedChoiceBranches':['audit','held'],'renderedGetParametersConsumed':True,
        'metadataItemCompletionShownByAudit':False,'actualTlsReadsOnly':True,'recordCountsUnchanged':True,
        'browserVerified':False,'httpVerified':False,'operationalAccessAccepted':False}
