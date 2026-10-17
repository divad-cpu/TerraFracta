import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { editorHarness, elements } from "./helpers/correction_draft_harness.mjs";
import { connectedInput } from "./helpers/connected_reader_fixture.mjs";
const projection = () => connectedInput().issue;
const connected = () => ({ ...connectedInput(), generation: 1 });
const h = scope => editorHarness(scope === "current" ? projection() : scope === "connected" ? connected() : undefined, scope);
const node = (editor, tag, suffix) => elements(editor.render()).find(row => row.type === tag && row.props.id?.endsWith(`-${suffix}`));
const button = (editor, text) => elements(editor.render()).find(row => row.type === "button" && row.props.children === text);
const detail = (editor, value) => node(editor, "textarea", "detail").props.onChange({ target: { value } });
const request = editor => editor.states().find(value => value?.requestId && value.draft);
const preview = editor => /Preview only · never submitted/.test(renderToStaticMarkup(editor.render()));
const uuid = n => `ec000000-0000-4000-8000-${String(n).padStart(12,"0")}`;

test("old correction review callbacks cannot restore earlier intent after a newer field edit target change or clear", t => {
 let identities = 0; t.mock.method(crypto, "randomUUID", () => uuid(++identities)); t.mock.method(globalThis,"fetch",()=>assert.fail("Network dispatched"));
 for (const scope of ["sample", "connected", "current"]) for (const change of ["detail", "source", "kind", "clear", ...(scope === "sample" ? [] : ["claim"])]) {
  const editor = h(scope); detail(editor,"Invented earlier explanation."); const old = button(editor,"Review draft").props.onClick;
  if (change === "detail") detail(editor,"Invented newer explanation.");
  if (change === "source") node(editor,"input","source").props.onChange({ target:{value:"https://example.org/newer"} });
  if (change === "kind") node(editor,"select","kind").props.onChange({ target:{value:"missing_context"} });
  if (change === "claim") node(editor,"select","claim").props.onChange({ target:{value:projection().claims[0].id} });
  if (change === "clear") button(editor,"Clear draft").props.onClick();
  const before = identities; old(); assert.equal(identities,before,`${scope}/${change}: stale entropy`);
  assert.equal(preview(editor),false,`${scope}/${change}: stale preview`); assert.equal(request(editor),undefined); editor.unmount();
 }
});
test("an old clear callback cannot remove newer correction wording or its reviewed request", t => {
 let identities = 0; t.mock.method(crypto,"randomUUID",()=>uuid(++identities));
 for (const scope of ["sample","connected","current"]) {
  const editor=h(scope); detail(editor,"Invented earlier explanation."); const old=button(editor,"Clear draft").props.onClick;
  detail(editor,"Invented newer explanation."); button(editor,"Review draft").props.onClick(); const before=request(editor);
  old(); assert.equal(node(editor,"textarea","detail").props.value,"Invented newer explanation."); assert.equal(preview(editor),true);
  assert.deepEqual(request(editor),before); editor.unmount();
 }
});
test("one correction review callback cannot prepare two private identities before the next render", t => {
 let identities=0; t.mock.method(crypto,"randomUUID",()=>uuid(++identities));
 for (const scope of ["connected","current"]) {
  const editor=h(scope); detail(editor,"Invented single intent explanation."); const callback=button(editor,"Review draft").props.onClick;
  const before=identities; callback(); const original=request(editor); assert.ok(original); callback();
  assert.equal(identities,before+1); assert.deepEqual(request(editor),original);
  button(editor,"Review draft").props.onClick(); assert.equal(identities,before+1); assert.deepEqual(request(editor),original); editor.unmount();
 }
});
test("retired correction callbacks cannot consume identity entropy after actual editor-key replacement or unmount", t => {
 let identities=0; t.mock.method(crypto,"randomUUID",()=>uuid(++identities));
 for (const scope of ["connected","current"]) {
  const editor=h(scope); detail(editor,"Invented retired explanation."); const old=button(editor,"Review draft").props.onClick;
  if(scope==="current") { const next=projection(); next.publicationId=uuid(900); next.revision=2; editor.render(next); }
  else { const next=connected(); next.generation=2; next.executionId=uuid(901); editor.render(next); }
  const before=identities; old(); assert.equal(identities,before); assert.equal(preview(editor),false); assert.equal(request(editor),undefined);
  detail(editor,"Invented before unmount."); const last=button(editor,"Review draft").props.onClick; editor.unmount(); last(); assert.equal(identities,before);
 }
});


test("correction actions and field callbacks stay inactive before mount admission and after explicit cleanup", t => {
 let identities=0; t.mock.method(crypto,"randomUUID",()=>uuid(++identities));
 const editor=editorHarness(projection(),"current",{autoCommit:false});
 const first=editor.render(), all=elements(first);
 const input=all.find(row=>row.type==="textarea"); input.props.onChange({target:{value:"Invented before admission."}});
 all.find(row=>row.type==="button"&&row.props.children==="Review draft").props.onClick();
 assert.equal(node(editor,"textarea","detail").props.value,""); assert.equal(identities,0);
 editor.commit(); detail(editor,"Invented admitted explanation."); button(editor,"Review draft").props.onClick(); assert.equal(identities,1);
 const lastInput=node(editor,"textarea","detail").props.onChange, lastClear=button(editor,"Clear draft").props.onClick;
 editor.unmount(); lastInput(new Proxy({}, {get(){assert.fail("Retired input observed event");}})); lastClear(); assert.deepEqual(editor.states(),[]); assert.equal(identities,1);
});
test("ordinary same-render correction field changes merge while a fresh normalized review retains the current request identity", t => {
 let identities=0; t.mock.method(crypto,"randomUUID",()=>uuid(++identities));
 const editor=h("current"), first=elements(editor.render());
 first.find(row=>row.type==="textarea").props.onChange({target:{value:"Invented combined field explanation."}});
 first.find(row=>row.type==="input").props.onChange({target:{value:"https://example.org/combined"}});
 first.find(row=>row.type==="select"&&row.props.id.endsWith("-kind")).props.onChange({target:{value:"missing_context"}});
 button(editor,"Review draft").props.onClick(); const original=request(editor); assert.ok(original); assert.equal(identities,1);
 assert.deepEqual(original.draft.fields,{kind:"missing_context",details:"Invented combined field explanation.",sourceUrl:"https://example.org/combined"});
 detail(editor,"  Invented combined field explanation.  "); button(editor,"Review draft").props.onClick(); assert.deepEqual(request(editor),original); assert.equal(identities,1); editor.unmount();
});


test("committed correction-key replacement retires review clear and input before deferred passive cleanup", t => {
 let identities=0; t.mock.method(crypto,"randomUUID",()=>uuid(++identities));
 for(const scope of ["sample","connected","current"]) for(const replacement of ["edition","withheld"]) {
  const initial=scope==="current"?projection():scope==="connected"?connected():undefined;
  const editor=editorHarness(initial,scope,{autoCommit:false}); editor.render();editor.commit();
  detail(editor,"Invented predecessor explanation.");const oldTree=elements(editor.render());
  const oldReview=oldTree.find(row=>row.type==="button"&&row.props.children==="Review draft").props.onClick;
  const oldClear=oldTree.find(row=>row.type==="button"&&row.props.children==="Clear draft").props.onClick;
  const oldInput=oldTree.find(row=>row.type==="textarea").props.onChange;
  const next=scope==="current"?projection():connected();
  if(replacement==="withheld") editor.render(null);
  else {if(scope==="current"){next.publicationId=uuid(950);next.revision=2;}else{next.generation=2;next.executionId=uuid(951);} editor.render(next);}
  editor.commitLayout();const before=identities;oldReview();oldClear();
  oldInput(new Proxy({}, {get(){assert.fail("Retired layout input observed event");}}));
  assert.equal(identities,before,`${scope}/${replacement}: stale entropy before passive cleanup`);
  assert.equal(request(editor),undefined);assert.equal(editor.states()[1]??"","");
  editor.flushPassive();editor.unmount();
 }
});


test('reset correction field generations refuse retained input before event access and admit fresh target input',()=>{
 for(const scope of ['sample','connected','current']) for(const mode of ['clear',...(scope==='sample'?[]:['target'])]) {
  const input=connectedInput(),initial=scope==='sample'?undefined:scope==='current'?input.issue:{...input,generation:1};const editor=editorHarness(initial,scope);
  let rows=elements(editor.render());const old=rows.filter(x=>['textarea','input','select'].includes(x.type));
  old.find(x=>x.type==='textarea').props.onChange({target:{value:'Invented predecessor explanation.'}});
  rows=elements(editor.render());if(mode==='clear')rows.find(x=>x.type==='button'&&x.props.children==='Clear draft').props.onClick();
  else rows.find(x=>x.type==='select'&&x.props.id.endsWith('-claim')).props.onChange({target:{value:input.issue.claims[0].id}});
  const before=editor.states();for(const field of old)field.props.onChange(new Proxy({}, {get(){assert.fail(`${scope}/${mode}: stale field observed event`);}}));assert.deepEqual(editor.states(),before);
  rows=elements(editor.render());rows.find(x=>x.type==='textarea').props.onChange({target:{value:'Invented fresh target explanation.'}});
  rows.find(x=>x.type==='input').props.onChange({target:{value:'https://example.org/fresh'}});
  assert.equal(editor.states()[1],'Invented fresh target explanation.');assert.equal(editor.states()[2],'https://example.org/fresh');editor.unmount();
 }
});
