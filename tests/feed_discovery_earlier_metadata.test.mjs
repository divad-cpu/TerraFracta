import assert from 'node:assert/strict';
import test from 'node:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadTsx} from './helpers/tsx_loader.mjs';
import {feedReport} from './helpers/feed_discovery_fixture.mjs';
const {FeedDiscoveryView:View}=loadTsx(new URL('../src/feed-discovery-view.tsx',import.meta.url));
const render=value=>renderToStaticMarkup(View({input:value}));
const earlier=text=>text.split('<h3>Earlier leads not reobserved as current candidates</h3>')[1]??assert.fail('Earlier section missing');
function sample(){
 const value=feedReport();
 for(const [i,row]of value.not_reobserved.entries()){
  const prior=value.previous.entries.find(entry=>entry.entry_id===row.previous.entry_id);
  Object.assign(prior,{url:`https://example.org/earlier-only-${i+1}`,published_text:`Earlier publication wording ${i+1}`,updated_text:`Earlier update wording ${i+1}`});
  row.previous=structuredClone(prior);
 }
 return value;
}

test('each non-reobserved lead exposes its complete exact earlier metadata independently of current candidates',()=>{
 const value=sample(),before=structuredClone(value),text=earlier(render(value));
 for(const [i,row]of value.not_reobserved.entries()){
  assert.match(text,new RegExp(`https://example.org/earlier-only-${i+1}`));
  assert.match(text,new RegExp(`Earlier publication wording ${i+1}`));assert.match(text,new RegExp(`Earlier update wording ${i+1}`));
  assert.ok(text.includes(row.previous.source_version_id));assert.ok(text.includes(row.previous.source_content_sha256));assert.ok(text.includes(row.previous.locator));
 }
 assert.equal((text.match(/Inspect earlier metadata for this lead/g)??[]).length,2);
 assert.match(text,/2026-10-14T11:00:00.000000Z/);assert.doesNotMatch(text,/2026-10-14T12:00:00.000000Z|Invented revised title/);
 assert.deepEqual(value,before);
});
test('rolled-off versus held-current explanations remain separate from earlier metadata dates and source state',()=>{
 const text=earlier(render(sample()));
 assert.match(text,/does not establish withdrawal or deletion/);assert.match(text,/Its current entry is held; no absence conclusion is possible/);
 assert.match(text,/Feed publication date text \(unparsed\)/);assert.match(text,/Feed modification date text \(unparsed\)/);
 assert.match(text,/Earlier supplied window retrieval/);assert.match(text,/Earlier document address \(not opened\)/);
 assert.doesNotMatch(text,/withdrawn document|document deleted|current source verified/);
});
test('missing earlier publication and modification date text remains Not supplied without invented current dates',()=>{
 const text=earlier(render(feedReport()));assert.equal((text.match(/Not supplied/g)??[]).length,4);
 assert.match(text,/Inspect earlier metadata for this lead/);
});
test('duplicate earlier document addresses and titles do not collapse distinct identity and locator occurrences',()=>{
 const value=feedReport(),text=earlier(render(value));assert.equal(value.not_reobserved[0].previous.url,value.not_reobserved[1].previous.url);
 assert.equal((text.match(/Inspect earlier metadata for this lead/g)??[]).length,2);
 for(const row of value.not_reobserved){assert.ok(text.includes(row.previous.entry_id));assert.ok(text.includes(row.previous.locator));}
});
test('hostile earlier-only metadata is escaped and addresses remain passive with no operation port',t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No source request'));
 const value=sample(),row=value.not_reobserved[0],entry=value.previous.entries.find(entry=>entry.entry_id===row.previous.entry_id);
 entry.title='<script>FICTIONAL_EARLIER_TITLE</script>';entry.published_text='<img src=x onerror=FICTIONAL_DATE>';row.previous=structuredClone(entry);
 const text=render(value);assert.match(text,/&lt;script&gt;FICTIONAL_EARLIER_TITLE/);assert.match(text,/&lt;img src=x onerror=FICTIONAL_DATE/);
 assert.doesNotMatch(text,/<script|<img|href=|<form|<input|<button|<textarea/);
});
test('forged previous metadata or missing prior window refuses the whole report without partial earlier details',()=>{
 for(const change of [v=>v.not_reobserved[0].previous.url='https://example.org/PRIVATE_FORGED',v=>v.previous=null]){
  const value=sample();change(value);const text=render(value);assert.match(text,/Discovery report unavailable/);
  assert.doesNotMatch(text,/PRIVATE_FORGED|earlier-only|Invented revised title|Inspect earlier metadata/);
 }
});
