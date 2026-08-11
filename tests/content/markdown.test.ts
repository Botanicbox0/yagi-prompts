import { describe, expect, it } from 'vitest';
import { markdownToText, parseMarkdown, parseInline, safeHref } from '@/lib/content/markdown';

/**
 * §6.1 `note = { md: Localized }` — the in-repo markdown subset.
 *
 * The parser emits a token tree, never HTML, so the renderer can never be an injection vector.
 * These tests pin the subset the product actually supports and the two refusals that matter.
 */

describe('inline markdown', () => {
  it('parses the four inline forms', () => {
    expect(parseInline('plain **bold** and *em* and `code`')).toEqual([
      { type: 'text', value: 'plain ' },
      { type: 'strong', children: [{ type: 'text', value: 'bold' }] },
      { type: 'text', value: ' and ' },
      { type: 'em', children: [{ type: 'text', value: 'em' }] },
      { type: 'text', value: ' and ' },
      { type: 'code', value: 'code' },
    ]);
  });

  it('keeps link text but drops the link when the href is not allowed', () => {
    const nodes = parseInline('[click](javascript:alert(1))');
    // The URL grammar is deliberately naive (no balanced parens — a note is not a CMS), so the
    // stray ")" survives as text. What must NOT survive is the link node or the scheme.
    expect(nodes.some((n) => n.type === 'link')).toBe(false);
    expect(JSON.stringify(nodes)).not.toContain('javascript');
    expect(JSON.stringify(nodes)).toContain('click');

    expect(parseInline('[ok](https://example.com)')).toEqual([
      { type: 'link', href: 'https://example.com', children: [{ type: 'text', value: 'ok' }] },
    ]);
  });

  it('allowlists protocols rather than blocklisting them', () => {
    expect(safeHref('https://example.com')).toBe('https://example.com');
    expect(safeHref('http://example.com')).toBe('http://example.com');
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(safeHref('/library')).toBe('/library');
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x', '//evil.example']) {
      expect(safeHref(bad), bad).toBeNull();
    }
  });

  it('leaves underscores alone — fixture sentinels must survive intact', () => {
    expect(parseInline('note (SENTINEL_PB1_S1_B1)')).toEqual([
      { type: 'text', value: 'note (SENTINEL_PB1_S1_B1)' },
    ]);
  });
});

describe('block markdown', () => {
  it('splits paragraphs on blank lines and joins wrapped lines', () => {
    const nodes = parseMarkdown('one\ntwo\n\nthree');
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({ type: 'paragraph' });
    expect(markdownToText('one\ntwo\n\nthree')).toBe('one two\nthree');
  });

  it('parses headings, both list kinds, quotes and fenced code', () => {
    const nodes = parseMarkdown(
      ['## Heading', '', '- a', '- b', '', '1. first', '2. second', '', '> careful', '', '```json', '{"a":1}', '```'].join('\n'),
    );
    expect(nodes.map((n) => n.type)).toEqual([
      'heading',
      'list',
      'list',
      'quote',
      'code',
    ]);
    expect(nodes[1]).toMatchObject({ type: 'list', ordered: false });
    expect(nodes[2]).toMatchObject({ type: 'list', ordered: true });
    expect(nodes[4]).toMatchObject({ type: 'code', lang: 'json', value: '{"a":1}' });
  });

  it('handles the real fixture note verbatim', () => {
    const nodes = parseMarkdown(
      '**Placeholder fixture content.** Crop to the shoulders, 1024px minimum. (SENTINEL_X_S1_B1)',
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ type: 'paragraph' });
    expect(markdownToText(nodes[0]!.type === 'paragraph' ? '**a** b' : '')).toBe('a b');
  });

  it('produces nothing for empty or whitespace-only input', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('\n\n   \n')).toEqual([]);
  });
});
