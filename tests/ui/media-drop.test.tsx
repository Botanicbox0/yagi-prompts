import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { MediaDrop, type MediaDropLabels } from '@/components/admin/media-drop';
import { mediaDropLabels } from '@/components/admin/prompt-fields';

/**
 * Founder direction (2026-08-13) — the admin media fields' drag/drop + frame-picker enhancement.
 *
 * What a server render can honestly pin is the PROGRESSIVE-ENHANCEMENT half of the contract
 * (M4's JS-free-admin doctrine): before hydration the markup must carry the two PLAIN file
 * inputs under their exact multipart names — the server operations read `video` and `poster`
 * and do not know the component exists. The zones, the scrubber and the canvas capture are
 * client-only behavior on top; their absence from static markup is the design, not a gap.
 */

/** The real mapping the admin screens use — one definition, so a new label cannot be forgotten. */
function labelsOf(): MediaDropLabels {
  return mediaDropLabels(getDictionary('ko').admin);
}

describe('MediaDrop (admin media enhancement)', () => {
  it('ships the two REAL multipart fields, visible, before any JavaScript runs', () => {
    const html = renderToStaticMarkup(
      <MediaDrop videoName="video" posterName="poster" labels={labelsOf()} />,
    );
    expect(html).toContain('name="video"');
    expect(html).toContain('name="poster"');
    expect(html).toContain('accept="video/*"');
    expect(html).toContain('accept="image/*"');
    // The no-JS state is a WORKING pair of pickers, not hidden stubs.
    expect(html).not.toContain('sr-only');
    // …and no zone chrome pretends to work without the client.
    expect(html).not.toContain(labelsOf().videoZone);
  });

  it('keeps the field names caller-controlled — the contests forms can reuse it later', () => {
    const html = renderToStaticMarkup(
      <MediaDrop videoName="heroVideo" posterName="heroPoster" labels={labelsOf()} />,
    );
    expect(html).toContain('name="heroVideo"');
    expect(html).toContain('name="heroPoster"');
    // No audioName ⇒ no audio field at all — the slot is opt-in per form.
    expect(html).not.toContain('accept="audio/*"');
  });

  it('ships the audio slot when asked, as the same plain-input contract', () => {
    const html = renderToStaticMarkup(
      <MediaDrop videoName="video" posterName="poster" audioName="audio" labels={labelsOf()} />,
    );
    expect(html).toContain('name="audio"');
    expect(html).toContain('accept="audio/*"');
  });

  it('holds the frame picker with a visible state until the row clip can be decoded', () => {
    const html = renderToStaticMarkup(
      <MediaDrop videoName="video" posterName="poster" labels={labelsOf()} existingVideoSrc="/api/admin/media/x" />,
    );
    expect(html).toContain('data-frame-state="loading"');
    expect(html).toContain(labelsOf().frameLoading);
    expect(html).toMatch(/<button[^>]*disabled/);
  });
});
