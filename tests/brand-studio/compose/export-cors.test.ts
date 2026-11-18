/**
 * Both editors export through `exportCompositionMp4`. The video studio's clips are media-domain addresses that
 * the preview already played without CORS, so the exporter must read them under their own cache entry
 * (`corsMediaUrl`, docs/BRAND-EDITING-STUDIO.md §1.3-5) or Chrome refuses the frames. Same-origin stream
 * addresses (the editing studio's) stay as they are.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportCompositionMp4 } from '@/lib/brand-studio/compose/export-client';
import type { ComposerProject } from '@/lib/brand-studio/compose';

const PAGE = 'https://brand.twings.app';

function clip(id: string, srcUrl: string) {
  return {
    id,
    label: id,
    sourceKind: 'asset' as const,
    srcUrl,
    durationSec: 4,
    trimStartSec: 0,
    trimEndSec: 4,
    volume: 1,
    muted: false,
  };
}

describe('export reads media-domain clips with their own CORS cache entry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads every clip through corsMediaUrl before drawing', async () => {
    const loaded: string[] = [];
    const fakeVideo = () => {
      const el: Record<string, unknown> & { onerror: (() => void) | null } = { onerror: null, onloadeddata: null };
      Object.defineProperty(el, 'src', {
        set(value: string) {
          loaded.push(value);
        },
      });
      el.load = () => el.onerror?.();
      return el;
    };
    vi.stubGlobal('location', { origin: PAGE });
    vi.stubGlobal('document', { createElement: () => fakeVideo() });

    const project: ComposerProject = {
      version: 1,
      aspect: '9:16',
      clips: [
        clip('a', 'https://media.twings.app/brand/a.mp4'),
        clip('b', '/api/brand-studio/compose?organizationId=x&source=asset&id=y'),
      ],
      captions: [],
      bgm: null,
      colorGrade: null,
    };

    await expect(exportCompositionMp4(project)).rejects.toThrow('video_load_failed');
    expect(loaded).toEqual([
      'https://media.twings.app/brand/a.mp4?cors=1',
      '/api/brand-studio/compose?organizationId=x&source=asset&id=y',
    ]);
  });
});
