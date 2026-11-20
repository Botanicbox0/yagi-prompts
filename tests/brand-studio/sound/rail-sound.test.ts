import { describe, expect, it } from 'vitest';
import { countByGroup, GROUP_SCREEN, jobGroup, onBoardFor, RAIL_HREF, toastFor } from '@/components/brand-workspace/rail-model';
import { studioShellEn, studioShellKo } from '@/messages/studio-shell';

/**
 * Real-screen check of 2026-11-21: after a music run the rail's credits stayed at the old figure while the sound
 * screen's own "남은 크레딧" moved. The sound screen now tells the rail when a run starts and settles (as the image
 * board does), and music and effects are their own group: before, the rail counted them as video and would have
 * toasted "영상이 완성됐어요" for a song.
 */
describe('the rail knows sound runs', () => {
  it('groups music and effects under the sound screen', () => {
    expect(jobGroup('music')).toBe('sound');
    expect(jobGroup('sound_effect')).toBe('sound');
    expect(jobGroup('video_final')).toBe('video');
    expect(GROUP_SCREEN.sound).toBe(RAIL_HREF.sound);
    expect(countByGroup([{ kind: 'music' }, { kind: 'image' }, { kind: 'sound_effect' }, { kind: 'video' }])).toEqual({ image: 1, video: 1, sound: 2 });
  });

  it('toasts a finished song on other screens only, in sound words', () => {
    const song = { id: 'j1', kind: 'music' as const, status: 'succeeded' as const };
    expect(onBoardFor('sound', '/brand/studio/sound')).toBe(true);
    expect(toastFor(song, '/brand/studio/sound', new Set())).toBeNull();
    expect(toastFor(song, '/brand/studio/video', new Set())).toEqual({ id: 'j1', group: 'sound', outcome: 'done' });
    for (const shell of [studioShellKo, studioShellEn]) {
      const toast = shell.toast;
      expect(toast.soundDone).toBeTruthy();
      expect(toast.soundFailed).toBeTruthy();
      expect(`${toast.soundDone} ${toast.soundFailed}`).not.toMatch(/영상|video/i);
    }
  });
});
