import assert from 'node:assert/strict';
import test from 'node:test';
import {publicSourceUrl, publicIssueProjectionSchema} from '../src/public-issue-projection.ts';
import {connectedInput} from './helpers/connected_reader_fixture.mjs';

for (const [name, url] of [
  ['LF in host', 'https://exa\nmple.org/table'],
  ['TAB in host', 'https://exa\tmple.org/table'],
  ['CR in path', 'https://example.org/ta\rble'],
  ['leading C0', '\u0000https://example.org/table'],
  ['trailing C0', 'https://example.org/table\u001f'],
  ['DEL in path', 'https://example.org/ta\u007fble'],
  ['backslash path', 'https://example.org\\table'],
  ['zero port', 'https://example.org:0/table'],
  ['overlong source', 'https://example.org/' + 'x'.repeat(2030)],
]) {
  test(`raw public source input refuses ${name} before parser rewriting`, () => {
    assert.equal(publicSourceUrl.safeParse(url).success, false);
    const {issue}=connectedInput(); issue.claims[0].evidence[0].url=url;
    assert.equal(publicIssueProjectionSchema.safeParse(issue).success, false,
      'a display projection must not acquire a repaired source URL');
  });
}
test('every raw ASCII control is refused throughout a URL', () => {
  for (const code of [...Array(32).keys(), 127]) {
    for (const value of [String.fromCharCode(code)+'https://example.org/table', 'https://example.org/ta'+String.fromCharCode(code)+'ble', 'https://example.org/table'+String.fromCharCode(code)])
      assert.equal(publicSourceUrl.safeParse(value).success,false,`raw control ${code}`);
  }
});
test('healthy existing source forms remain accepted and keep Zod URL output', () => {
  for (const value of ['https://example.org/table?lang=en&year=2025','https://example.org:1/table','https://example.org:65535/table','https://example.org/a%20b','https://example.org/øvelse','https://0x7f.example.org/table','https://example.org/'+'x'.repeat(2028)]) {
    assert.equal(publicSourceUrl.parse(value), value);
    const {issue}=connectedInput();issue.claims[0].evidence[0].url=value;
    assert.equal(publicIssueProjectionSchema.safeParse(issue).success,true);
  }
  assert.equal(publicSourceUrl.parse(' https://example.org/table '),'https://example.org/table');
});
test('existing local, malformed and sensitive-query refusals remain closed', () => {
  for (const value of ['https://0x7f.0.0.1/table','https://127.1/table','https://data.local/table','https://example.org/table?%61pi_key=INVENTED','https://user:INVENTED@example.org/table','https://example.org:65536/table','https://example.org/table#private'])
    assert.equal(publicSourceUrl.safeParse(value).success,false);
});
