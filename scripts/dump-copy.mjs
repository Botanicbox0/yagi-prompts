#!/usr/bin/env node
/** Static dictionary inventory. No application imports, environment reads, or database access.
 * Usage: node scripts/dump-copy.mjs --out tmp/copy-catalog.csv
 * Optional: --root <checkout> --keys <one-key-per-line.txt> --no-leaf-candidates
 * source_usage contains AST references/candidates, NOT verified rendered routes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const propertyName = node => ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node) ? node.text : null;
const unwrap = node => {
  while (node && (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node))) node = node.expression;
  return node;
};
const visit = (node, fn) => { fn(node); ts.forEachChild(node, child => visit(child, fn)); };

/** Read only the exported locale object's string leaves; never execute a dictionary module. */
export function readDictionary(root, locale) {
  const filename = path.join(root, 'messages', `${locale}.ts`);
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let object;
  visit(source, node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === locale) object = unwrap(node.initializer);
  });
  if (!object || !ts.isObjectLiteralExpression(object)) throw new Error(`Cannot find literal ${locale} dictionary`);
  const result = new Map();
  function read(node, prefix) {
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) throw new Error(`Unsupported dictionary member: ${prefix.join('.')}`);
      const name = propertyName(property.name);
      if (name === null) throw new Error('Computed dictionary key is unsupported');
      const key = [...prefix, name]; const value = unwrap(property.initializer);
      if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) result.set(key.join('.'), value.text);
      else if (ts.isObjectLiteralExpression(value)) read(value, key);
      else throw new Error(`Nonliteral dictionary value: ${key.join('.')}`);
    }
  }
  read(object, []); return result;
}

function sourceFiles(root) {
  const roots = ['app', 'components', 'lib'].filter(dir => fs.existsSync(path.join(root, dir)));
  const rg = spawnSync('rg', ['--files', ...roots, '-g', '*.ts', '-g', '*.tsx'], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (!rg.error && rg.status === 0) return rg.stdout.split(/\r?\n/).filter(Boolean).sort();
  // Portable fallback when ripgrep is not installed; stay inside the three source roots.
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const relative = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(relative);
      else if (entry.isFile() && /\.tsx?$/.test(entry.name)) files.push(relative);
    }
  }
  roots.forEach(walk); return files.sort();
}

function chain(node) {
  node = unwrap(node);
  if (!node) return null;
  if (ts.isIdentifier(node)) return { parts: [node.text], dynamic: false };
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'getDictionary') return { parts: ['$dictionary'], dynamic: false };
  if (ts.isPropertyAccessExpression(node)) { const base = chain(node.expression); return base ? { parts: [...base.parts, node.name.text], dynamic: base.dynamic } : null; }
  if (ts.isElementAccessExpression(node)) {
    const base = chain(node.expression); if (!base) return null;
    const key = node.argumentExpression && (ts.isStringLiteral(node.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(node.argumentExpression)) ? node.argumentExpression.text : null;
    return key === null ? { ...base, dynamic: true } : { parts: [...base.parts, key], dynamic: base.dynamic };
  }
  return null;
}

/** Conservative, file-local alias resolution plus explicitly marked unresolved leaf candidates.
 * This is not TypeScript whole-program dataflow, route reachability, or runtime coverage.
 */
export function collectSourceUsage(root, keys, { leafCandidates = true } = {}) {
  const keySet = new Set(keys), usage = new Map(keys.map(key => [key, new Set()])), unresolved = new Map();
  const sources = sourceFiles(root).map(file => ({ file: file.replaceAll('\\', '/'), ast: ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS) }));
  const types = new Map([['Dictionary', []]]);
  function typePath(node) {
    if (!node) return null;
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) return types.get(node.typeName.text) ?? null;
    if (ts.isIndexedAccessTypeNode(node) && ts.isLiteralTypeNode(node.indexType) && ts.isStringLiteral(node.indexType.literal)) { const base = typePath(node.objectType); return base ? [...base, node.indexType.literal.text] : null; }
    return null;
  }
  for (let round = 0; round < 3; round++) for (const { ast } of sources) visit(ast, node => { if (ts.isTypeAliasDeclaration(node)) { const prefix = typePath(node.type); if (prefix) types.set(node.name.text, prefix); } });
  for (const { file, ast } of sources) {
    const aliases = new Map([['$dictionary', []]]);
    const resolve = node => { const value = chain(node); if (!value) return null; const prefix = aliases.get(value.parts[0]); return prefix ? [...prefix, ...value.parts.slice(1)] : null; };
    visit(ast, node => {
      if ((ts.isParameter(node) || ts.isPropertySignature(node) || ts.isVariableDeclaration(node)) && ts.isIdentifier(node.name)) { const prefix = typePath(node.type); if (prefix) aliases.set(node.name.text, prefix); }
    });
    for (let round = 0; round < 4; round++) visit(ast, node => {
      if (!ts.isVariableDeclaration(node) || !node.initializer) return;
      const prefix = resolve(node.initializer); if (!prefix) return;
      if (ts.isIdentifier(node.name)) aliases.set(node.name.text, prefix);
      else if (ts.isObjectBindingPattern(node.name)) for (const element of node.name.elements) {
        if (ts.isIdentifier(element.name)) aliases.set(element.name.text, [...prefix, propertyName(element.propertyName ?? element.name)]);
      }
    });
    visit(ast, node => {
      if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return;
      if ((ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent)) && node.parent.expression === node) return;
      const value = chain(node); if (!value || value.parts.length < 2) return;
      const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
      const at = `${file}:${line}`;
      const prefix = aliases.get(value.parts[0]);
      const resolved = prefix ? [...prefix, ...value.parts.slice(1)].join('.') : null;
      if (resolved && keySet.has(resolved)) usage.get(resolved).add(`${at} [AST property]`);
      else if (resolved && value.dynamic) {
        for (const key of keys) if (key.startsWith(`${resolved}.`)) usage.get(key).add(`${at} [dynamic-key candidate]`);
      } else {
        const suffix = value.parts.slice(1).join('.');
        if (keySet.has(suffix)) usage.get(suffix).add(`${at} [unresolved-root candidate]`);
        else if (leafCandidates && !value.dynamic) {
          const leaf = value.parts.at(-1);
          if (!unresolved.has(leaf)) unresolved.set(leaf, new Set());
          unresolved.get(leaf).add(`${at} [unresolved-leaf candidate]`);
        }
      }
    });
  }
  for (const key of keys) if (usage.get(key).size === 0 && leafCandidates) for (const candidate of unresolved.get(key.split('.').at(-1)) ?? []) usage.get(key).add(candidate);
  return new Map([...usage].map(([key, values]) => [key, [...values].sort().join(' | ')]));
}

export function csvCell(value) {
  let text = String(value ?? '');
  // Quoting alone does not stop spreadsheet formula execution. Preserve display as plain text.
  if (/^[\t\r\n ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export const toCsv = rows => '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';

function main(args) {
  if (args.includes('--help')) { console.log('node scripts/dump-copy.mjs [--root checkout] [--out file.csv] [--keys keys.txt] [--no-leaf-candidates]\nCSV: key,ko,en,source_usage. Usage entries are static references/candidates, not rendered-route evidence.'); return; }
  const option = name => { const index = args.indexOf(name); if (index < 0) return null; const value = args[index + 1]; if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`); return value; };
  const root = path.resolve(option('--root') ?? DEFAULT_ROOT);
  const ko = readDictionary(root, 'ko'), en = readDictionary(root, 'en');
  const keyFile = option('--keys');
  const keys = keyFile ? [...new Set(fs.readFileSync(path.resolve(keyFile), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean))] : [...new Set([...ko.keys(), ...en.keys()])].sort();
  if (keys.some(key => !ko.has(key) || !en.has(key))) throw new Error('A selected dictionary key is absent in one locale');
  const usage = collectSourceUsage(root, keys, { leafCandidates: !args.includes('--no-leaf-candidates') });
  const output = toCsv([['key', 'ko', 'en', 'source_usage'], ...keys.map(key => [key, ko.get(key), en.get(key), usage.get(key)])]);
  const out = option('--out');
  if (out) { const target = path.resolve(out); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, output, 'utf8'); console.error(`Wrote ${keys.length} bilingual keys to ${target}; source_usage is static analysis, not route coverage.`); }
  else process.stdout.write(output);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
