import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { studioEditorEn, studioEditorKo } from '@/messages/studio-editor';

/**
 * A locked workspace (colour, sound, captions on a real film) must not be a dead end: the thing it
 * cannot do yet is available in the earlier editor today, so the panel says so and links there. The
 * link is the same address as the header's way back, which carries `classic=1` so an organization
 * that opens the new editor by default is not sent straight back.
 */
const root = process.cwd();
const panels = readFileSync(join(root, 'components/brand-studio/editor-v2/panels.tsx'), 'utf8');
const editor = readFileSync(join(root, 'components/brand-studio/editor-v2/editor-v2.tsx'), 'utf8');
const page = readFileSync(join(root, 'app/(brand)/brand/studio/editor/page.tsx'), 'utf8');

describe('a locked workspace points to the earlier editor', () => {
  it('renders the link only inside the locked panel, with the address the header uses', () => {
    expect(panels).toContain('data-editor-classic-link={workspace}');
    expect(panels).toContain('<LockedPanel api={api} classicHref={classicHref} />');
    expect(editor).toContain('<ActionPanel api={api} classicHref={currentEditorHref} />');
    expect(editor).toContain('href={currentEditorHref}');
  });

  it('the address back to the earlier editor skips the switch', () => {
    expect(page).toMatch(/classic/);
    expect(page).toMatch(/\/brand\/studio\/compose/);
  });

  it('says in both languages what the earlier editor has for each locked workspace', () => {
    for (const copy of [studioEditorEn, studioEditorKo]) {
      for (const key of ['classicColor', 'classicSound', 'classicCaptions'] as const) expect(copy.real.locked[key].length).toBeGreaterThan(10);
      expect(copy.notice.current.length).toBeGreaterThan(3);
    }
    expect(studioEditorKo.notice.current).toBe('예전 편집기 열기');
    expect(studioEditorKo.real.locked.classicColor).toContain('예전 편집기');
  });
});
