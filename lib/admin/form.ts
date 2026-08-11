import type { Localized } from '@/lib/content/schemas';
import { isVisibility, type Visibility } from '@/lib/content/visibility';

/**
 * FormData → typed values, for the plain-HTML admin forms (§3.8: "build forms with plain server
 * actions", §4: the admin surface is allowed to look like a tool).
 *
 * No client JS anywhere in the editor, so everything arrives as strings and Files. These readers do
 * the mechanical part only; §6.1 validation is zod's job in `operations.ts`, and every rule the
 * DATABASE owns (immutability, locale completeness, manifest currentness) stays in the database.
 */

export const OP_FIELD = '_op';
export const BACK_FIELD = '_back';

export function str(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/** Preserves interior whitespace and newlines — prompts and markdown need them. */
export function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : '';
}

export function bool(form: FormData, name: string): boolean {
  const value = form.get(name);
  return value === 'on' || value === 'true' || value === '1';
}

/** `''` → null so an emptied optional number clears the column instead of becoming 0. */
export function optionalInt(form: FormData, name: string): number | null | undefined {
  const raw = str(form, name);
  if (raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.trunc(value) : undefined;
}

export function optionalNumber(form: FormData, name: string): number | null | undefined {
  const raw = str(form, name);
  if (raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** Comma-separated tag input (§3.8 "tools/models (tag inputs)") — no client JS required. */
export function tags(form: FormData, name: string): string[] {
  return str(form, name)
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function localized(form: FormData, prefix: string): Localized {
  return { en: text(form, `${prefix}En`), ko: text(form, `${prefix}Ko`) };
}

/** A `{en, ko}` pair that is entirely blank means "no value", not "two empty strings". */
export function optionalLocalized(form: FormData, prefix: string): Localized | null {
  const value = localized(form, prefix);
  return value.en === '' && value.ko === '' ? null : value;
}

/** The visibility select: `''` is the inherit option (§3.8 "inherit (→ effective default)"). */
export function visibilityChoice(raw: string): Visibility | null | undefined {
  if (raw === '' || raw === 'inherit') return null;
  return isVisibility(raw) ? raw : undefined;
}

export function visibility(form: FormData, name: string): Visibility | null | undefined {
  return visibilityChoice(str(form, name));
}

export function file(form: FormData, name: string): File | null {
  const value = form.get(name);
  if (value === null || typeof value === 'string') return null;
  const candidate = value as File;
  if (typeof candidate.arrayBuffer !== 'function') return null;
  // An untouched `<input type="file">` still posts an empty File in some runtimes.
  return candidate.size > 0 || candidate.name !== '' ? candidate : null;
}

/** Repeated fields (`paramKey` × N) zipped into rows, blank keys dropped. */
export function rows(form: FormData, keyField: string, valueField: string) {
  const keys = form.getAll(keyField).map((v) => (typeof v === 'string' ? v.trim() : ''));
  const values = form.getAll(valueField).map((v) => (typeof v === 'string' ? v.trim() : ''));
  const out: Array<{ k: string; v: string }> = [];
  for (const [index, k] of keys.entries()) {
    if (k === '') continue;
    out.push({ k, v: values[index] ?? '' });
  }
  return out;
}

/** Every `prefix{id}` field in one pass — used by the bulk override table and the policy page. */
export function prefixedEntries(form: FormData, prefix: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [key, value] of form.entries()) {
    if (!key.startsWith(prefix) || typeof value !== 'string') continue;
    out.push([key.slice(prefix.length), value.trim()]);
  }
  return out;
}
