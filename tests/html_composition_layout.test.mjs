import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';import {renderToStaticMarkup} from 'react-dom/server';import {loadTsx} from './helpers/tsx_loader.mjs';
const layout=loadTsx(new URL('../app/layout.tsx',import.meta.url),n=>n==='./globals.css'?{}:n==='./components'?{DemoNotice:()=>null}:n==='./site-navigation'?{SiteNavigation:()=>null}:undefined);
test('both new HTML composition pages share the actual layout sole main landmark and skip-link target',()=>{
 for(const name of['html-append-review','html-capture-sample']){
 const page=loadTsx(new URL(`../app/editorial-preview/${name}/page.tsx`,import.meta.url),n=>n==='next/navigation'?{notFound(){throw Error('NOT_FOUND');}}:n.startsWith('../../../fixtures/')?{default:JSON.parse(readFileSync(new URL(n,new URL(`../app/editorial-preview/${name}/page.tsx`,import.meta.url)),'utf8'))}:undefined);
 const h=renderToStaticMarkup(layout.default({children:page.default()}));assert.equal((h.match(/<main\b/g)||[]).length,1,name);assert.match(h,/<main id="main" tabindex="-1">/);assert.equal((h.match(/id="main"/g)||[]).length,1);assert.match(h,/href="#main"/);
 }
});
