import { describe, expect, it } from 'vitest';
import {
  AssetRefSchema,
  BLOCK_KINDS,
  LocalizedSchema,
  kindHasAsset,
  parseBlock,
  safeParseBlock,
} from '@/lib/content/schemas';

/** PLAN §6.1 — the schemas are the single source for forms, renderers and RPC revalidation. */
describe('block content contracts (§6.1)', () => {
  const SHA = 'b'.repeat(64);
  const ref = { staging_key: 'content/rev/r/a.png', sha256: SHA, mime: 'image/png' };

  it('covers exactly the six kinds', () => {
    expect([...BLOCK_KINDS]).toEqual(['prompt', 'params', 'asset', 'note', 'link', 'workflow_file']);
    expect(BLOCK_KINDS.filter(kindHasAsset)).toEqual(['asset', 'workflow_file']);
  });

  it('requires both locales in a Localized value', () => {
    expect(LocalizedSchema.safeParse({ en: 'a', ko: '가' }).success).toBe(true);
    expect(LocalizedSchema.safeParse({ en: 'a' }).success).toBe(false);
    expect(LocalizedSchema.safeParse({ en: 'a', ko: '' }).success).toBe(false);
  });

  it('requires a 64-hex sha256 on every AssetRef (manifest input)', () => {
    expect(AssetRefSchema.safeParse(ref).success).toBe(true);
    expect(AssetRefSchema.safeParse({ ...ref, sha256: 'nope' }).success).toBe(false);
    const { sha256: _drop, ...withoutSha } = ref;
    expect(AssetRefSchema.safeParse(withoutSha).success).toBe(false);
  });

  it('accepts the canonical shape of each kind', () => {
    expect(parseBlock('prompt', { text: 't' }).kind).toBe('prompt');
    expect(parseBlock('params', { rows: [{ k: 'a', v: 'b' }] }).kind).toBe('params');
    expect(parseBlock('asset', { asset: ref }).kind).toBe('asset');
    expect(parseBlock('note', { md: { en: 'a', ko: '가' } }).kind).toBe('note');
    expect(parseBlock('link', { url: 'https://x.test', label: { en: 'a', ko: '가' } }).kind).toBe(
      'link',
    );
    expect(
      parseBlock('workflow_file', {
        asset: ref,
        filename: 'g.json',
        size_bytes: 1,
        format: 'comfyui',
      }).kind,
    ).toBe('workflow_file');
  });

  it('rejects content that belongs to a different kind', () => {
    expect(safeParseBlock('prompt', { md: { en: 'a', ko: '가' } }).success).toBe(false);
    expect(safeParseBlock('note', { text: 'x' }).success).toBe(false);
    expect(safeParseBlock('link', { url: 'not-a-url', label: { en: 'a', ko: '가' } }).success).toBe(
      false,
    );
  });

  it('leaves prompts untranslated by design (§3.9)', () => {
    const parsed = parseBlock('prompt', { text: 'english only prompt', negative: 'blurry' });
    expect(parsed.content).toEqual({ text: 'english only prompt', negative: 'blurry' });
  });
});
