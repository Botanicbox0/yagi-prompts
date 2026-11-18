import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { VideoComposer, type VideoComposerProps } from '@/components/brand-studio/compose/video-composer';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { allowance, ORG } from '../ui/fixtures';
import { assistFixture } from './fixture';

const copy = getDictionary('ko').studioCompose;

function render(extra: Partial<VideoComposerProps>): string {
  return renderToStaticMarkup(
    h(VideoComposer, {
      organizationId: ORG,
      locale: 'ko',
      canCreate: true,
      copy,
      videoStudioHref: `/brand/studio/video?organizationId=${ORG}`,
      initialAllowance: allowance(),
      initialAssets: [],
      initialVideoOutputs: [],
      initialProject: assistFixture(),
      ...extra,
    }),
  );
}

describe('VideoComposer — BRAND_STUDIO_EDIT_ASSIST', () => {
  it('flag off (and absent): the chat panel exactly as before, nothing of "말로 편집"', () => {
    const absent = render({});
    const off = render({ editAssist: false });
    expect(off).toBe(absent);
    expect(off).toContain('data-compose-chat');
    expect(off).toContain('data-compose-chat-input');
    expect(off).toContain(copy.chat.lead);
    expect(off).not.toContain('data-assist-');
    expect(off).not.toContain('data-compose-redo');
    expect(off).not.toContain('inert');
    expect(off).not.toContain('aria-disabled');
  });

  it('flag on: the "말로 편집" panel and a redo button replace the chat panel; nothing is locked yet', () => {
    const on = render({ editAssist: true });
    expect(on).toContain('data-assist-panel');
    expect(on).toContain('data-assist-log');
    expect(on).toContain('data-compose-redo');
    expect(on).toContain(`>${copy.assist.redo}<`);
    expect(on).not.toContain('data-compose-chat');
    expect(on).not.toContain(copy.chat.lead);
    // No proposal: no preview bar, no locked controls, no changed cuts.
    expect(on).not.toContain('data-assist-preview-bar');
    expect(on).not.toContain('inert');
    expect(on).not.toContain('data-assist-changed');
    // The redo button starts disabled (nothing undone yet).
    expect(on.match(/<button[^>]*data-compose-redo[^>]*>/)?.[0]).toContain('disabled');
  });
});
