/** Congela o grafo de imports de execução, incluindo JSONs e imports dinâmicos. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const target = resolve(process.argv[2] ?? join(root, '.cache/bot-baseline'));
if (existsSync(target)) throw new Error(`A referência já existe: ${target}`);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const files = {};
const seen = new Set();
const external = new Set();
const outputPath = path => extname(path) === '.json' ? path : path.replace(/\.[cm]?[jt]sx?$/, '.mjs');
function dependency(specifier, parent) {
  if (!specifier.startsWith('@/') && !specifier.startsWith('.')) return null;
  const base = specifier.startsWith('@/') ? join(root, 'src', specifier.slice(2)) : resolve(dirname(parent), specifier);
  const path = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]
    .find(p => existsSync(p) && extname(p));
  if (!path || !path.startsWith(join(root, 'src') + sep)) throw new Error(`Import não isolável: ${specifier} em ${parent}`);
  return path;
}
function freeze(path) {
  if (seen.has(path)) return;
  seen.add(path);
  const local = relative(root, path);
  const raw = readFileSync(path, 'utf8');
  let content = raw;
  if (extname(path) !== '.json') {
    const emitted = ts.transpileModule(raw, { compilerOptions: { target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, verbatimModuleSyntax: true } }).outputText;
    const source = ts.createSourceFile(local, emitted, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const transformed = ts.transform(source, [context => {
      const f = context.factory;
      const visit = node => {
        const dynamic = ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword;
        const spec = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier
          : dynamic ? node.arguments[0] : null;
        if (spec && ts.isStringLiteral(spec)) {
          const dep = dependency(spec.text, path);
          if (!dep) { external.add(spec.text); return node; }
          freeze(dep);
          let name = relative(dirname(outputPath(path)), outputPath(dep)).split(sep).join('/');
          if (!name.startsWith('.')) name = `./${name}`;
          const literal = f.createStringLiteral(name);
          const json = extname(dep) === '.json';
          const attributes = json ? f.createImportAttributes([f.createImportAttribute(f.createIdentifier('type'), f.createStringLiteral('json'))]) : undefined;
          if (ts.isImportDeclaration(node)) return f.updateImportDeclaration(node, node.modifiers, node.importClause, literal, attributes);
          if (ts.isExportDeclaration(node)) return f.updateExportDeclaration(node, node.modifiers, node.isTypeOnly, node.exportClause, literal, attributes);
          return f.updateCallExpression(node, node.expression, node.typeArguments, json
            ? [literal, f.createObjectLiteralExpression([f.createPropertyAssignment('with', f.createObjectLiteralExpression([f.createPropertyAssignment('type', f.createStringLiteral('json'))]))])]
            : [literal]);
        }
        return ts.visitEachChild(node, visit, context);
      };
      return node => ts.visitNode(node, visit);
    }]);
    content = ts.createPrinter().printFile(transformed.transformed[0]);
    transformed.dispose();
  }
  const destination = relative(root, outputPath(path));
  mkdirSync(dirname(join(target, destination)), { recursive: true });
  writeFileSync(join(target, destination), content);
  files[destination] = { source: local, sourceHash: sha(raw), sha256: sha(content) };
}
freeze(join(root, 'src/lib/duel/bot/bot-brain.ts'));
freeze(join(root, 'src/lib/duel/auto-response.ts'));
freeze(join(root, 'src/lib/duel/board-state.ts'));
freeze(join(root, 'src/lib/duel/official-card-data.ts'));
freeze(join(root, 'src/data/card-db.json'));
for (const name of ['preset-decks.json', 'preset-decks-tcg.json']) freeze(join(root, 'src/data', name));
const manifest = { schema: 1, revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  node: process.version, entry: 'src/lib/duel/bot/bot-brain.mjs', external: [...external].sort(),
  lockHash: sha(readFileSync(join(root, 'package-lock.json'))), files };
writeFileSync(join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Referência isolada: ${target} (${seen.size} arquivos)`);
