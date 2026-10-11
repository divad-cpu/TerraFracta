// Existing locked TypeScript parser reads supplied JavaScript as syntax only.
// No evaluated target code, file selection, environment loading or network.
import ts from 'typescript';
const refuse = () => { process.stdout.write('{"kind":"unavailable"}\n'); process.exit(1); };
if (process.argv.length !== 2) refuse();
const chunks = []; let bytes = 0;
for await (const chunk of process.stdin) {
  bytes += chunk.length; if (bytes > 1_048_576) refuse(); chunks.push(chunk);
}
let text;
try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); } catch { refuse(); }
const source = ts.createSourceFile('env-context.js', text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
if (source.parseDiagnostics.length) refuse();
const literals = []; let alteredJson = false;
function boundJson(name) {
  if (!name) return false;
  if (ts.isIdentifier(name)) return name.text === 'JSON';
  return ts.isBindingPattern(name) && name.elements.some(item => ts.isBindingElement(item) && boundJson(item.name));
}
function jsonTarget(node) {
  return (ts.isIdentifier(node) && node.text === 'JSON') ||
    (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'JSON') ||
    (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'JSON');
}
function visit(node) {
  if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node) ||
       ts.isFunctionExpression(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node) ||
       ts.isImportClause(node) || ts.isImportSpecifier(node) ||
       ts.isNamespaceImport(node)) && boundJson(node.name)) alteredJson = true;
  if (ts.isWithStatement(node) || (ts.isBinaryExpression(node) && jsonTarget(node.left) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment)) alteredJson = true;
  if (ts.isCallExpression(node) && !node.questionDotToken && ts.isPropertyAccessExpression(node.expression) &&
      !node.expression.questionDotToken && ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'JSON' && node.expression.name.text === 'parse' &&
      node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
    literals.push(node.arguments[0].text);
  }
  ts.forEachChild(node, visit);
}
visit(source);
if (alteredJson || literals.length > 16) refuse();
const output = JSON.stringify({ kind: 'json_literals', literals });
if (Buffer.byteLength(output) > 65_536) refuse();
process.stdout.write(output + '\n');
