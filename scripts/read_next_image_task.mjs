// Read the retained Next image-detector task as syntax using locked TypeScript.
// This never evaluates the input or authenticates executed build bindings.
import ts from 'typescript';

const refuse = () => { process.stdout.write('{"kind":"unavailable"}\n'); process.exit(1); };
if (process.argv.length !== 2) refuse();
const chunks = []; let bytes = 0;
for await (const chunk of process.stdin) {
  bytes += chunk.length; if (bytes > 262_144) refuse(); chunks.push(chunk);
}
let text;
try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); } catch { refuse(); }
const source = ts.createSourceFile('next-build-task.js', text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
if (source.parseDiagnostics.length) refuse();
const tasks = source.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ncc_image_detector');
if (tasks.length !== 1) refuse();
const task = tasks[0];
const modifiers = task.modifiers?.map(node => node.kind) ?? [];
if (modifiers.length !== 2 || !modifiers.includes(ts.SyntaxKind.ExportKeyword) ||
    !modifiers.includes(ts.SyntaxKind.AsyncKeyword) || task.asteriskToken ||
    task.parameters.length !== 2 || !task.body || task.body.statements.length !== 1) refuse();
for (const [i, name] of ['task', 'opts'].entries()) {
  const parameter = task.parameters[i];
  if (!ts.isIdentifier(parameter.name) || parameter.name.text !== name || parameter.initializer ||
      parameter.dotDotDotToken || parameter.questionToken || parameter.type) refuse();
}
const statement = task.body.statements[0];
if (!ts.isExpressionStatement(statement) || !ts.isAwaitExpression(statement.expression)) refuse();
function method(node, name, count) {
  if (!ts.isCallExpression(node) || node.questionDotToken || node.arguments.length !== count ||
      !ts.isPropertyAccessExpression(node.expression) || node.expression.questionDotToken ||
      node.expression.name.text !== name) refuse();
  return node;
}
function literal(node, expected) {
  if (!ts.isStringLiteral(node) || node.text !== expected) refuse();
}
function identifier(node, expected) {
  if (!ts.isIdentifier(node) || node.text !== expected) refuse();
}
const target = method(statement.expression.expression, 'target', 1);
literal(target.arguments[0], 'src/compiled/image-detector');
const ncc = method(target.expression.expression, 'ncc', 1);
const options = ncc.arguments[0];
if (!ts.isObjectLiteralExpression(options) || options.properties.length !== 2) refuse();
let packageName = false; let externals = false;
for (const property of options.properties) {
  if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) &&
      property.name.text === 'packageName' && !packageName) {
    literal(property.initializer, 'image-size'); packageName = true;
  } else if (ts.isShorthandPropertyAssignment(property) && property.name.text === 'externals' &&
      !property.objectAssignmentInitializer && !externals) {
    externals = true;
  } else refuse();
}
if (!packageName || !externals) refuse();
const input = method(ncc.expression.expression, 'source', 1);
identifier(input.expression.expression, 'task');
const relative = input.arguments[0];
if (!ts.isCallExpression(relative) || relative.questionDotToken || relative.arguments.length !== 2) refuse();
identifier(relative.expression, 'relative'); identifier(relative.arguments[0], '__dirname');
const resolve = method(relative.arguments[1], 'resolve', 1);
identifier(resolve.expression.expression, 'require'); literal(resolve.arguments[0], 'image-size/dist/detector.js');
process.stdout.write(JSON.stringify({ kind: 'image_detector_task_syntax', task: 'ncc_image_detector',
  inputPackageSubpath: 'image-size/dist/detector.js', nccPackageName: 'image-size',
  outputDirectory: 'src/compiled/image-detector', syntaxOnly: true, executedBindingsAuthenticated: false }) + '\n');
