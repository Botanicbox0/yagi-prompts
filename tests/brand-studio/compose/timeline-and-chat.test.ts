import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  appendClip,
  applyTimelinePatches,
  emptyComposerProject,
  frameStateAtTime,
  parseStoredProject,
  projectDurationSec,
  serializeProjectForStorage,
} from '@/lib/brand-studio/compose/timeline';
import * as composeCredits from '@/lib/brand-studio/compose/credits';
import { parseComposeChatCommand } from '@/lib/brand-studio/compose/chat-intent';
import { resetComposeChatRateLimitsForTest, runComposeOperation } from '@/lib/brand-studio/compose/service';
import { studioFixture, viewerOf } from '../server/helpers';
import { studioRuntimeDeps } from '@/lib/brand-studio/runtime';

describe('composer timeline model', () => {
  it('computes spans, active frames, captions, BGM looping, and drops local blob URLs on persist', () => {
    let project = emptyComposerProject('9:16');
    project = appendClip(project, {
      id: 'c1',
      label: 'Opening shot',
      sourceKind: 'asset',
      assetId: '00000000-0000-4000-8000-000000000001',
      srcUrl: '/api/brand-studio/compose?organizationId=org&source=asset&id=1',
      durationSec: 6,
      trimStartSec: 1,
      trimEndSec: 5,
      volume: 1,
      muted: false,
    });
    project = appendClip(project, {
      id: 'c2',
      label: 'Local clip',
      sourceKind: 'local',
      srcUrl: 'blob:http://localhost:3000/abc',
      durationSec: 4,
      trimStartSec: 0,
      trimEndSec: 4,
      volume: 0.8,
      muted: false,
    });
    project = {
      ...project,
      bgm: {
        label: 'Ambient loop',
        sourceKind: 'asset',
        srcUrl: '/api/brand-studio/compose?organizationId=org&source=asset&id=2',
        durationSec: 3,
        trimStartSec: 0,
        volume: 0.4,
      },
    };

    expect(projectDurationSec(project)).toBe(8);

    const patched = applyTimelinePatches(project, [
      { op: 'add_caption', text: 'TWINGS 26SS', anchor: 'end', durationSec: 2, position: 'bottom', size: 'lg' },
    ]).project;

    const midFirst = frameStateAtTime(patched, 2);
    expect(midFirst.activeClip?.index).toBe(0);
    expect(midFirst.activeClip?.mediaTimeSec).toBeCloseTo(3, 2);
    expect(midFirst.activeCaptions).toHaveLength(0);

    const nearEnd = frameStateAtTime(patched, 7);
    expect(nearEnd.activeClip?.index).toBe(1);
    expect(nearEnd.activeClip?.mediaTimeSec).toBeCloseTo(3, 2);
    expect(nearEnd.activeCaptions.map((c) => c.text)).toEqual(['TWINGS 26SS']);
    expect(nearEnd.bgmTimeSec).toBeCloseTo(1, 2);

    // Local blob URL is never persisted to localStorage, while server asset clip survives.
    const serialized = serializeProjectForStorage(patched);
    expect(serialized).not.toContain('blob:');
    const restored = parseStoredProject(serialized);
    expect(restored?.clips).toHaveLength(1);
    expect(restored?.clips[0]?.id).toBe('c1');
    expect(restored?.captions[0]?.text).toBe('TWINGS 26SS');
  });
});

describe('chat timeline command parser & TWINGS credit policy (Decision 3)', () => {
  function sampleProject() {
    let p = emptyComposerProject('9:16');
    p = appendClip(p, {
      id: 'c1',
      label: 'Cut 1',
      sourceKind: 'output',
      srcUrl: '/clip1.mp4',
      durationSec: 6,
      trimStartSec: 0,
      trimEndSec: 6,
      volume: 1,
      muted: false,
    });
    p = appendClip(p, {
      id: 'c2',
      label: 'Cut 2',
      sourceKind: 'output',
      srcUrl: '/clip2.mp4',
      durationSec: 5,
      trimStartSec: 0,
      trimEndSec: 5,
      volume: 1,
      muted: false,
    });
    return {
      ...p,
      bgm: {
        label: 'Track',
        sourceKind: 'asset' as const,
        srcUrl: '/bgm.mp3',
        durationSec: 20,
        trimStartSec: 0,
        volume: 0.6,
      },
    };
  }

  it('parses compound Korean instructions (trim + end caption) and applies them cleanly', () => {
    const project = sampleProject();
    const parsed = parseComposeChatCommand("1번째 컷 3초로 줄이고 마지막에 'TWINGS 26SS' 자막 넣어줘", project, 'ko');
    expect(parsed.kind).toBe('patches');
    if (parsed.kind !== 'patches') return;
    expect(parsed.patches).toHaveLength(2);

    const { project: next, appliedCount } = applyTimelinePatches(project, parsed.patches);
    expect(appliedCount).toBe(2);
    expect(next.clips[0]?.trimEndSec).toBe(3);
    expect(projectDurationSec(next)).toBe(8);
    expect(next.captions).toHaveLength(1);
    expect(next.captions[0]).toMatchObject({
      text: 'TWINGS 26SS',
      startSec: 5.5,
      endSec: 8,
    });
  });

  it('handles swap, reorder, BGM volume, clip mute, aspect ratio, and undo in ko and en', () => {
    const project = sampleProject();

    const swap = parseComposeChatCommand('1번과 2번 순서 바꿔줘', project, 'ko');
    expect(swap).toMatchObject({ kind: 'patches', patches: [{ op: 'swap_clips', indexA: 0, indexB: 1 }] });

    const bgm = parseComposeChatCommand('배경음악 볼륨 30%로 낮춰줘', project, 'ko');
    expect(bgm).toMatchObject({ kind: 'patches', patches: [{ op: 'set_bgm_volume', volume: 0.3 }] });

    const mute = parseComposeChatCommand('원본 소리 다 꺼줘', project, 'ko');
    // Muting keeps each cut's volume (turning the sound back on restores it).
    expect(mute.kind === 'patches' && mute.patches).toEqual([{ op: 'set_clip_audio', clipIndex: 'all', muted: true }]);

    const wide = parseComposeChatCommand('가로 16:9로 바꿔줘', project, 'ko');
    expect(wide).toMatchObject({ kind: 'patches', patches: [{ op: 'set_aspect', aspect: '16:9' }] });

    const eng = parseComposeChatCommand("Trim cut 2 to 2.5s and add 'Summer Drop' caption at the end", project, 'en');
    expect(eng.kind).toBe('patches');
    if (eng.kind === 'patches') expect(eng.patches).toHaveLength(2);

    expect(parseComposeChatCommand('되돌려줘', project, 'ko')).toEqual({ kind: 'undo' });
    expect(parseComposeChatCommand('undo', project, 'en')).toEqual({ kind: 'undo' });
  });

  it('prices no 1080p export and exposes zero BYOK or vendor names in UI/copy', () => {
    // Export is free (docs/BRAND-EDITING-STUDIO.md §8-3): no per-second export price is left to compute.
    expect(Object.keys(composeCredits).sort()).toEqual(['COMPOSE_FINAL_RENDER_MODEL', 'COMPOSE_RENDER_REFUND_WINDOW_MS']);

    const copySource = readFileSync(resolve(process.cwd(), 'messages/studio-compose.ts'), 'utf8');
    const uiSource = readFileSync(resolve(process.cwd(), 'components/brand-studio/compose/video-composer.tsx'), 'utf8');
    for (const forbidden of ['OpenAI', 'Anthropic', 'ChatGPT', 'Claude', 'byok', 'BYOK']) {
      expect(copySource).not.toContain(forbidden);
    }
    for (const forbidden of ['OpenAI', 'Anthropic', 'ChatGPT', 'Claude', 'byokOpen', 'requestByokTimelinePatches']) {
      expect(uiSource).not.toContain(forbidden);
    }
  });

  it('translates free-form server chat instructions via structured schema at 0 credit cost', async () => {
    resetComposeChatRateLimitsForTest();
    const f = await studioFixture({ capKrw: 5_000 });
    try {
      const deps = await studioRuntimeDeps(f.sql);
      const project = sampleProject();
      const fakeFetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            candidates: [
              {
                finishReason: 'STOP',
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        patches: [{ op: 'trim_clip', clipIndex: 0, targetDurationSec: 2.5 }],
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }) as unknown as typeof fetch;

      const res = await runComposeOperation(
        deps,
        viewerOf(f.ids.owner),
        'chat.edit',
        {
          organizationId: f.orgId,
          message: 'make the opening punchier around two and a half seconds please',
          locale: 'en',
          project,
        },
        {
          env: { GEMINI_API_KEY: 'test-gemini-key' },
          fetchImpl: fakeFetch,
        },
      );

      expect(res).toMatchObject({
        ok: true,
        kind: 'patches',
        creditsUsed: 0,
        patches: [{ op: 'trim_clip', clipIndex: 0, targetDurationSec: 2.5 }],
      });
      expect(fakeFetch).toHaveBeenCalledTimes(1);
    } finally {
      await f.db.close();
      resetComposeChatRateLimitsForTest();
    }
  });
});
