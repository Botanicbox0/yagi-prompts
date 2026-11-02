import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export function flattenStrings(value: unknown, prefix = ''): Map<string, string> {
  if (typeof value === 'string') return new Map([[prefix, value]]);
  if (!value || typeof value !== 'object') throw new Error(`Non-string dictionary leaf: ${prefix}`);
  return new Map(Object.entries(value).flatMap(([key, child]) => [...flattenStrings(child, prefix ? `${prefix}.${key}` : key)]));
}

/** Quote every cell, preserve newlines, and neutralize spreadsheet formula execution. */
export function csvCell(value: string | number): string {
  let text = String(value);
  if (/^[\s]*[=+@-]/u.test(text) || /^[\t\r]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function csv(headers: string[], rows: Array<Array<string | number>>): string {
  // Match the repository's eol=lf policy so --check also passes after a fresh checkout.
  return '\uFEFF' + [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
}

export interface Usage { file: string; line: number; kind: 'static' | 'dynamic-set' | 'object-transfer' }
export interface Literal { file: string; line: number; kind: string; text: string; routes: string[] }
export interface Inventory {
  uses: Map<string, Usage[]>;
  routesByFile: Map<string, string[]>;
  routeFiles: Array<{ file: string; route: string }>;
  literals: Literal[];
}

function filesUnder(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name);
    return entry.isDirectory() ? filesUnder(full) : /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  }).sort();
}

export function routeFromFile(file: string): string {
  const segments = file.replaceAll('\\', '/').replace(/^app\//, '').split('/');
  segments.pop();
  return '/' + segments.filter((part) => !/^\(.*\)$/.test(part) && !part.startsWith('@')).join('/');
}

/**
 * Compiler symbols follow Dictionary aliases and props, unlike a `dict.foo` regexp.
 * Import reachability is deliberately a candidate route set, NOT proof of visible rendering.
 * No application modules execute; no environment files, databases or network are read.
 */
export function analyzeSources(root: string, dictionaryFile = 'messages/en.ts'): Inventory {
  const sourceFiles = ['app', 'components', 'lib', 'messages'].flatMap((dir) => filesUnder(path.join(root, dir)));
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.Preserve,
    strict: true, skipLibCheck: true, baseUrl: root, paths: { '@/*': ['./*'] },
    noEmit: true, types: [],
  };
  const program = ts.createProgram(sourceFiles, options);
  const checker = program.getTypeChecker();
  const rel = (name: string) => path.relative(root, name).replaceAll('\\', '/');
  const sources = program.getSourceFiles().filter((source) => sourceFiles.includes(source.fileName) || sourceFiles.some((name) => path.resolve(name) === path.resolve(source.fileName)));
  const canonical = new Map(sources.map((source) => [path.resolve(source.fileName).toLowerCase(), rel(source.fileName)]));
  const dictionary = sources.find((source) => rel(source.fileName) === dictionaryFile);
  if (!dictionary) throw new Error('Dictionary source not found');
  const propertyKeys = new Map<ts.Declaration, string>();
  const allKeys = new Set<string>();
  function readObject(node: ts.Node, prefix: string) {
    if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) return readObject(node.expression, prefix);
    if (!ts.isObjectLiteralExpression(node)) return;
    for (const prop of node.properties) {
      if (!ts.isPropertyAssignment(prop)) throw new Error('Dictionary spreads/methods need an explicit extractor');
      const name = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : null;
      if (!name) throw new Error('Computed dictionary keys are unsupported');
      const key = prefix ? `${prefix}.${name}` : name;
      propertyKeys.set(prop, key);
      if (ts.isStringLiteralLike(prop.initializer)) allKeys.add(key);
      else readObject(prop.initializer, key);
    }
  }
  dictionary.forEachChild(function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'en' && node.initializer) readObject(node.initializer, '');
    ts.forEachChild(node, visit);
  });
  const symbolKeys = (symbol: ts.Symbol | undefined) => (symbol?.declarations ?? []).flatMap((declaration) => {
    const key = propertyKeys.get(declaration);
    return key ? [key] : [];
  });
  const uses = new Map<string, Usage[]>();
  const imports = new Map<string, Set<string>>();
  const literals: Literal[] = [];
  for (const source of sources) {
    const file = rel(source.fileName);
    if (file.startsWith('messages/')) continue;
    const dependencies = new Set<string>();
    imports.set(file, dependencies);
    const seen = new Set<string>();
    function add(key: string, node: ts.Node, kind: Usage['kind']) {
      if (!allKeys.has(key)) return;
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      const token = `${key}:${line}:${kind}`;
      if (seen.has(token)) return;
      seen.add(token);
      uses.set(key, [...(uses.get(key) ?? []), { file, line, kind }]);
    }
    function literal(node: ts.Node, text: string, kind: string) {
      const clean = text.replace(/\s+/g, ' ').trim();
      if (!/[a-zA-Z가-힣]/.test(clean) || clean.length < 2) return;
      literals.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, kind, text: clean, routes: [] });
    }
    function visit(node: ts.Node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const resolved = ts.resolveModuleName(node.moduleSpecifier.text, source.fileName, options, ts.sys).resolvedModule;
        const target = resolved && canonical.get(path.resolve(resolved.resolvedFileName).toLowerCase());
        // Type-only imports have no rendered dependency.
        if (target && !(ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) && !(ts.isExportDeclaration(node) && node.isTypeOnly)) dependencies.add(target);
      }
      if (ts.isPropertyAccessExpression(node)) {
        for (const key of symbolKeys(checker.getSymbolAtLocation(node.name))) add(key, node, 'static');
      }
      if (ts.isElementAccessExpression(node)) {
        const type = checker.getTypeAtLocation(node.expression);
        const arg = node.argumentExpression;
        if (ts.isStringLiteral(arg)) {
          for (const key of symbolKeys(type.getProperty(arg.text))) add(key, node, 'static');
        } else {
          for (const prop of type.getProperties()) for (const key of symbolKeys(prop)) {
            // Includes nested status maps selected dynamically (e.g. email.statusSubject).
            for (const leaf of allKeys) if (leaf === key || leaf.startsWith(`${key}.`)) add(leaf, node, 'dynamic-set');
          }
        }
      }
      if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent) && ts.isIdentifier(node.name)) {
        const name = node.propertyName && ts.isIdentifier(node.propertyName) ? node.propertyName.text : node.name.text;
        for (const key of symbolKeys(checker.getTypeAtLocation(node.parent).getProperty(name))) add(key, node, 'static');
      }
      if (ts.isJsxExpression(node) && ts.isJsxAttribute(node.parent) && node.expression) {
        const passed = checker.getTypeAtLocation(node.expression);
        const keys = passed.getProperties().flatMap((prop) => symbolKeys(prop));
        // Narrow copy bundles are passed to non-Dictionary interfaces (e.g. BrandFormLabels).
        // Do not count passing the entire dictionary as every leaf being used.
        const common = keys.length ? keys[0]!.split('.').filter((part, index, prefix) => keys.every((key) => key.split('.').slice(0, index + 1).join('.') === prefix.slice(0, index + 1).join('.'))) : [];
        if (common.length >= 2) {
          for (const key of keys) for (const leaf of allKeys) {
            if (leaf === key || leaf.startsWith(`${key}.`)) add(leaf, node, 'object-transfer');
          }
        }
      }
      if (!file.startsWith('lib/legal/')) {
        if (ts.isJsxText(node)) literal(node, node.text, 'jsx-text');
        else if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer) && ['title', 'alt', 'placeholder', 'aria-label'].includes(node.name.getText(source))) literal(node, node.initializer.text, `jsx-${node.name.getText(source)}`);
        else if (ts.isStringLiteralLike(node) && /[가-힣]/.test(node.text)) literal(node, node.text, 'localized-literal-candidate');
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  const routeFiles = sources.map((source) => rel(source.fileName)).filter((file) => /^app\/(?:.+\/)?(page|route)\.tsx?$/.test(file)).map((file) => ({ file, route: routeFromFile(file) }));
  const routesByFile = new Map<string, string[]>();
  for (const { file, route } of routeFiles) {
    const visited = new Set<string>();
    const pending = [file];
    // Layouts and route error/loading boundaries also participate in the candidate graph.
    let directory = path.posix.dirname(file);
    while (directory === 'app' || directory.startsWith('app/')) {
      for (const boundary of ['layout', 'error', 'loading', 'not-found']) {
        const candidate = `${directory}/${boundary}.tsx`;
        if (imports.has(candidate)) pending.push(candidate);
      }
      directory = path.posix.dirname(directory);
    }
    while (pending.length) {
      const current = pending.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      routesByFile.set(current, [...new Set([...(routesByFile.get(current) ?? []), route])].sort());
      for (const dependency of imports.get(current) ?? []) pending.push(dependency);
    }
  }
  for (const literal of literals) literal.routes = routesByFile.get(literal.file) ?? [];
  for (const entries of uses.values()) entries.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.kind.localeCompare(b.kind));
  return { uses, routesByFile, routeFiles: routeFiles.sort((a, b) => a.file.localeCompare(b.file)), literals };
}
