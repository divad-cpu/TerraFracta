import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadTsx } from './helpers/tsx_loader.mjs';
const fixture = (files, run) => {
 const dir = mkdtempSync(join(tmpdir(), 'tf-tsx-diagnostic-'));
 try { for (const [name, source] of Object.entries(files)) writeFileSync(join(dir, name), source); return run(pathToFileURL(join(dir, 'entry.tsx'))); }
 finally { rmSync(dir, { recursive: true, force: true }); }
};
const malformed = 'process.executed = true; export const view = <input onChange={()=>{try{}catch{}}/>;';
test('malformed TSX is refused before emitted code or dependency interception runs', () => fixture({ 'entry.tsx': malformed }, url => {
 const processValue = { executed: false }; let intercepted = 0;
 assert.throws(() => loadTsx(url, () => { intercepted++; return { jsx: () => ({}) }; }, processValue), error => error instanceof SyntaxError && error.message === 'TSX fixture compilation failed.');
 assert.equal(processValue.executed, false); assert.equal(intercepted, 0);
}));
test('nested TSX syntax errors also refuse the imported module before its body runs', () => fixture({ 'entry.tsx': 'export { view } from "./child.tsx";', 'child.tsx': malformed }, url => {
 const processValue = { executed: false };
 assert.throws(() => loadTsx(url, name => name === "react/jsx-runtime" ? { jsx: () => ({}) } : undefined, processValue), SyntaxError);
 assert.equal(processValue.executed, false);
}));
test('valid JSX keeps explicit imports and process substitutions', () => fixture({ 'entry.tsx': 'export const view = <p>{process.env.FIXED}</p>;' }, url => {
 const seen = [];
 const result = loadTsx(url, name => { seen.push(name); return { jsx: (type, props) => ({ type, props }) }; }, { env: { FIXED: 'local' } });
 assert.deepEqual(result.view, { type: 'p', props: { children: 'local' } }); assert.deepEqual(seen, ['react/jsx-runtime']);
}));
test('syntax diagnostics do not pretend to perform semantic type checking', () => fixture({ 'entry.tsx': 'export const value: number = "requires actual typecheck";' }, url => {
 assert.equal(loadTsx(url).value, 'requires actual typecheck');
}));
