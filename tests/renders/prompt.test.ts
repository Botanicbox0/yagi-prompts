import { describe, expect, it } from 'vitest';
import { IDENTITY_LOCK_IMAGE, IDENTITY_LOCK_VIDEO, buildRenderPrompt } from '@/lib/renders/prompt';

describe('template recipe → engine prompt', () => {
  it('keeps a film recipe that names the photo exactly, in ModelArk’s positional prose', () => {
    const out = buildRenderPrompt({ promptText: 'Interview in a 1994 studio. @image1 is the interviewee.', medium: 'video', hasPhoto: true });
    expect(out.text).toBe('Interview in a 1994 studio. Image 1 is the interviewee.');
    expect(out.namesPhoto).toBe(true);
    expect(out.references.images).toEqual([1]);
  });

  it('adds the identity lock to a film recipe that never mentions the photo', () => {
    const out = buildRenderPrompt({ promptText: 'Interview in a 1994 studio.', medium: 'video', hasPhoto: true });
    expect(out.text).toBe(`Interview in a 1994 studio.\n\n${IDENTITY_LOCK_VIDEO}`);
    expect(out.namesPhoto).toBe(false);
  });

  it('speaks of "the reference photo" to an image engine, and of "the subject" with no photo', () => {
    const withPhoto = buildRenderPrompt({ promptText: 'Portrait of @image1 by a window.', medium: 'image', hasPhoto: true });
    expect(withPhoto.text).toBe('Portrait of the reference photo by a window.');
    expect(withPhoto.text).not.toContain(IDENTITY_LOCK_IMAGE);

    const without = buildRenderPrompt({ promptText: 'Portrait of @image1 by a window.', medium: 'image', hasPhoto: false });
    expect(without.text).toBe('Portrait of the subject by a window.');
  });

  it('adds the image identity lock only when the recipe is silent about the photo', () => {
    const out = buildRenderPrompt({ promptText: 'Static portrait by a window.', medium: 'image', hasPhoto: true });
    expect(out.text).toBe(`Static portrait by a window.\n\n${IDENTITY_LOCK_IMAGE}`);
    const none = buildRenderPrompt({ promptText: 'Static portrait by a window.', medium: 'image', hasPhoto: false });
    expect(none.text).toBe('Static portrait by a window.');
  });
});
