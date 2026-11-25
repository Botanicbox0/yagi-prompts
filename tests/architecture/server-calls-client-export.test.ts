import { readFile, readdir } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Server components and route handlers under `app/` must never import non-component values
 * (functions, helpers, uppercase constants) from `'use client'` modules — Next.js replaces
 * client exports with client-reference proxies on the server, so calling or reading them
 * throws at runtime (`Attempted to call … from the server`).
 */

const ROOT = process.cwd();
const ENTRY_FILE = /^(page\.tsx|layout\.tsx|route\.tsx?)$/;

/** Known pre-existing violations on main (must not grow; remove once fixed). */
const KNOWN_VIOLATIONS: readonly string[] = [];

async function walk(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map((entry) => {
        const full = resolve(dir, entry.name);
        return entry.isDirectory() ? walk(full) : Promise.resolve([full]);
      }),
    );
    return nested.flat();
  } catch {
    return [];
  }
}

function hasDirective(sf: ts.SourceFile, directive: string): boolean {
  for (const statement of sf.statements) {
    if (ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)) {
      if (statement.expression.text === directive) return true;
    } else {
      break;
    }
  }
  return false;
}

/** Lowercase-starting identifiers (functions/helpers/hooks) or ALL_CAPS constants. */
function isNonComponentValueName(name: string): boolean {
  return /^[a-z_$]/.test(name) || /^[A-Z][A-Z0-9_]+$/.test(name);
}

/** True when `sf` exports `name` exclusively as a TypeScript type/interface (erased at runtime). */
function isTypeOnlyExport(sf: ts.SourceFile, name: string): boolean {
  let sawType = false;
  let sawValue = false;
  for (const st of sf.statements) {
    const mods = ts.canHaveModifiers(st) ? ts.getModifiers(st) : undefined;
    const isExported = Boolean(mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
    if (isExported && (ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st))) {
      if (st.name.text === name) sawType = true;
    } else if (isExported && (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st))) {
      if (st.name?.text === name) sawValue = true;
    } else if (isExported && ts.isVariableStatement(st)) {
      for (const decl of st.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === name) sawValue = true;
      }
    } else if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) {
        if (el.name.text !== name) continue;
        if (st.isTypeOnly || el.isTypeOnly) sawType = true;
        else sawValue = true;
      }
    }
  }
  return sawType && !sawValue;
}

describe('server files do not import non-component values from use-client modules', () => {
  it('catches any non-component, non-type value imported from a client module by app/ server files', async () => {
    const allSources = new Set(
      (await Promise.all(['app', 'components', 'lib'].map((d) => walk(resolve(ROOT, d)))))
        .flat()
        .filter((f) => /\.[cm]?[jt]sx?$/.test(f)),
    );

    const parsed = new Map<string, ts.SourceFile>();
    const parse = async (file: string): Promise<ts.SourceFile> => {
      let sf = parsed.get(file);
      if (!sf) {
        sf = ts.createSourceFile(
          file,
          await readFile(file, 'utf8'),
          ts.ScriptTarget.Latest,
          true,
          file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
        );
        parsed.set(file, sf);
      }
      return sf;
    };

    const resolveTarget = (fromFile: string, specifier: string): string | null => {
      const stem = specifier.startsWith('@/')
        ? resolve(ROOT, specifier.slice(2))
        : specifier.startsWith('.')
          ? resolve(dirname(fromFile), specifier)
          : null;
      if (!stem) return null;
      for (const candidate of [stem, `${stem}.ts`, `${stem}.tsx`, resolve(stem, 'index.ts'), resolve(stem, 'index.tsx')]) {
        if (allSources.has(candidate)) return candidate;
      }
      return null;
    };

    const appDir = resolve(ROOT, 'app');
    const serverEntries = [...allSources]
      .filter((f) => f.startsWith(appDir) && ENTRY_FILE.test(f.split(/[\\/]/).pop() ?? ''))
      .sort();

    const violations: string[] = [];

    for (const file of serverEntries) {
      const sf = await parse(file);
      if (hasDirective(sf, 'use client')) continue;

      const relFile = relative(ROOT, file).replaceAll('\\', '/');
      for (const st of sf.statements) {
        if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
        const clause = st.importClause;
        if (!clause || clause.isTypeOnly) continue;

        const target = resolveTarget(file, st.moduleSpecifier.text);
        if (!target) continue;
        const targetSf = await parse(target);
        if (!hasDirective(targetSf, 'use client')) continue;

        const relTarget = relative(ROOT, target).replaceAll('\\', '/');

        if (clause.name && isNonComponentValueName(clause.name.text)) {
          violations.push(`${relFile} -> ${relTarget} (default:${clause.name.text})`);
        }
        if (clause.namedBindings) {
          if (ts.isNamespaceImport(clause.namedBindings)) {
            violations.push(`${relFile} -> ${relTarget} (* as ${clause.namedBindings.name.text})`);
          } else {
            for (const el of clause.namedBindings.elements) {
              if (el.isTypeOnly) continue;
              const exportedName = (el.propertyName ?? el.name).text;
              if (!isNonComponentValueName(exportedName)) continue;
              if (isTypeOnlyExport(targetSf, exportedName)) continue;
              violations.push(`${relFile} -> ${relTarget} (${exportedName})`);
            }
          }
        }
      }
    }

    const known = new Set(KNOWN_VIOLATIONS);
    const unexpected = violations.filter((v) => !known.has(v));
    const resolvedKnown = KNOWN_VIOLATIONS.filter((v) => !violations.includes(v));

    expect(
      unexpected,
      `Server files imported non-component values from 'use client' modules:\n${unexpected.join('\n')}`,
    ).toEqual([]);
    expect(
      resolvedKnown,
      `Remove fixed entries from KNOWN_VIOLATIONS:\n${resolvedKnown.join('\n')}`,
    ).toEqual([]);
  });
});
