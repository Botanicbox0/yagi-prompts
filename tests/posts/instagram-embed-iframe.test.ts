import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const EMBED_COMPONENT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../components/posts/instagram-embed.tsx',
);

describe('InstagramEmbed iframe attributes', () => {
  it('disables iframe scrolling while preserving referrerPolicy and sandbox', () => {
    const source = readFileSync(EMBED_COMPONENT_PATH, 'utf8');
    const match = source.match(/<iframe\b[\s\S]*?data-instagram-iframe[\s\S]*?\/>/);

    expect(match).not.toBeNull();
    const iframeTag = match![0];

    expect(iframeTag).toContain('scrolling="no"');
    expect(iframeTag).toContain('referrerPolicy="no-referrer"');
    expect(iframeTag).toContain(
      'sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"',
    );
  });
});
