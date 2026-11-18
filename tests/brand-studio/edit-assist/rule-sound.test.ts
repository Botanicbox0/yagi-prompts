import { describe, expect, it } from 'vitest';
import { parseComposeChatCommand } from '@/lib/brand-studio/compose/chat-intent';
import { applyTimelinePatches, type ComposerProject } from '@/lib/brand-studio/compose/timeline';
import { diffTimelines } from '@/lib/brand-studio/edit-assist/diff';
import { assistFixture } from './fixture';

/**
 * The rule parser's cut-sound patches (shared by `chat.edit` and `assist.plan`) on the shared timeline:
 * c1 and c2 at 100 %, c3 at 70 %, c4 muted at 100 %. Muting is a switch, not a volume: it keeps each cut's
 * level, so turning the sound back on brings that level back.
 */
function run(message: string, project: ComposerProject = assistFixture()) {
  const parsed = parseComposeChatCommand(message, project, 'ko');
  if (parsed.kind !== 'patches') throw new Error(`the rule parser did not read: ${message}`);
  return { patches: parsed.patches, after: applyTimelinePatches(project, parsed.patches).project };
}

const sound = (project: ComposerProject) => project.clips.map((clip) => [clip.volume, clip.muted]);

describe('rule parser: a cut’s own sound', () => {
  it('mutes every cut without touching a level, and turning the sound back on restores each one', () => {
    const muted = run('모든 컷 원본 소리 꺼줘');
    expect(muted.patches).toEqual([{ op: 'set_clip_audio', clipIndex: 'all', muted: true }]);
    expect(sound(muted.after)).toEqual([
      [1, true],
      [1, true],
      [0.7, true],
      [1, true],
    ]);
    expect(diffTimelines(assistFixture(), muted.after)).toEqual([{ kind: 'clip_sound', cut: 'all', muted: true }]);

    const back = run('모든 컷 소리 켜줘', muted.after);
    expect(back.patches).toEqual([{ op: 'set_clip_audio', clipIndex: 'all', muted: false }]);
    expect(sound(back.after)).toEqual([
      [1, false],
      [1, false],
      [0.7, false],
      [1, false],
    ]);
  });

  it('mutes one named cut and keeps its level', () => {
    const { patches, after } = run('세 번째 컷 소리 꺼줘');
    expect(patches).toEqual([{ op: 'set_clip_audio', clipIndex: 2, muted: true }]);
    expect(after.clips[2]).toMatchObject({ volume: 0.7, muted: true });
  });

  it('turns a cut back on at its own level, or at the level the user names; never 100 % by default', () => {
    const level = { ...assistFixture() };
    level.clips = level.clips.map((clip, i) => (i === 3 ? { ...clip, volume: 0.4 } : clip));
    const on = run('네 번째 컷 소리 켜줘', level);
    expect(on.patches).toEqual([{ op: 'set_clip_audio', clipIndex: 3, muted: false }]);
    expect(on.after.clips[3]).toMatchObject({ volume: 0.4, muted: false });

    const named = run('네 번째 컷 소리 80%로 켜줘', level);
    expect(named.patches).toEqual([{ op: 'set_clip_audio', clipIndex: 3, volume: 0.8, muted: false }]);
    expect(named.after.clips[3]).toMatchObject({ volume: 0.8, muted: false });
  });
});
