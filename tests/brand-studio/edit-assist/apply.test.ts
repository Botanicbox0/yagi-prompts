import { describe, expect, it } from 'vitest';
import {
  MAX_COMPOSE_CAPTIONS,
  MAX_COMPOSE_CLIPS,
  projectDurationSec,
  type ComposerProject,
} from '@/lib/brand-studio/compose/timeline';
import {
  applyEditSteps,
  resolveAskChoices,
  resolveEditPlan,
  type ResolvedStep,
} from '@/lib/brand-studio/edit-assist/apply';
import type { EditStep } from '@/lib/brand-studio/edit-assist/plan';
import { assistFixture, deepFreeze, FIXTURE_REFS } from './fixture';

function resolved(steps: EditStep[]): ResolvedStep[] {
  const result = resolveEditPlan(steps, FIXTURE_REFS);
  if (!result.ok) throw new Error(`unresolved: ${JSON.stringify(result.problems)}`);
  return result.steps;
}

function run(steps: EditStep[], project: ComposerProject = assistFixture()) {
  return applyEditSteps(project, resolved(steps));
}

/** `[id, trimStart, trimEnd]` per clip, in timeline order. */
function cuts(project: ComposerProject): Array<[string, number, number]> {
  return project.clips.map((c) => [c.id, c.trimStartSec, c.trimEndSec]);
}

function ok(steps: EditStep[], project?: ComposerProject): ComposerProject {
  const result = run(steps, project);
  expect(result.problems).toEqual([]);
  return result.project;
}

describe('resolveEditPlan', () => {
  it('replaces refs with ids, and split-piece refs with the cut they come from', () => {
    const result = resolveEditPlan(
      [
        { do: 'split', clip: 'c2', at: 2 },
        { do: 'trim', clip: 'c2b', keep: 'start', seconds: 1 },
        { do: 'move', clip: 'c4', to: { before: 'c2a' } },
        { do: 'sound', target: 'c3', muted: true },
        { do: 'caption_add', text: 'a', where: { clip: 'c1' } },
        { do: 'caption_edit', caption: 't2', text: 'b' },
        { do: 'caption_remove', caption: 'all' },
        { do: 'fit_total', seconds: 12, protect: ['c4'] },
      ],
      FIXTURE_REFS,
    );
    expect(result).toEqual({
      ok: true,
      steps: [
        { do: 'split', clip: { clipId: 'clip-hand' }, at: 2 },
        { do: 'trim', clip: { splitOf: 'clip-hand', part: 'b' }, keep: 'start', seconds: 1 },
        { do: 'move', clip: { clipId: 'clip-logo' }, to: { before: { splitOf: 'clip-hand', part: 'a' } } },
        { do: 'sound', target: { clipId: 'clip-run' }, muted: true },
        { do: 'caption_add', text: 'a', where: { clip: { clipId: 'clip-open' } } },
        { do: 'caption_edit', caption: { captionId: 'cap-sale' }, text: 'b' },
        { do: 'caption_remove', caption: 'all' },
        { do: 'fit_total', seconds: 12, protect: [{ clipId: 'clip-logo' }] },
      ],
    });
  });

  it('lists every unknown ref with its step', () => {
    const result = resolveEditPlan(
      [
        { do: 'remove', clip: 'c9' },
        { do: 'caption_remove', caption: 't3' },
        { do: 'move', clip: 'c1', to: { after: 'c7' } },
        { do: 'fit_total', seconds: 10, protect: ['c1', 'c8a'] },
      ],
      FIXTURE_REFS,
    );
    expect(result).toEqual({
      ok: false,
      problems: [
        { step: 0, code: 'unknown_ref', ref: 'c9' },
        { step: 1, code: 'unknown_ref', ref: 't3' },
        { step: 2, code: 'unknown_ref', ref: 'c7' },
        { step: 3, code: 'unknown_ref', ref: 'c8a' },
      ],
    });
  });
});

describe('resolveAskChoices', () => {
  it('turns choices into values the screen can use, and refuses unknown refs', () => {
    expect(resolveAskChoices('which_clip', ['c1', 'c3', 'all'], FIXTURE_REFS)).toEqual([
      { clipId: 'clip-open' },
      { clipId: 'clip-run' },
      'all',
    ]);
    expect(resolveAskChoices('which_caption', ['t2', 't1'], FIXTURE_REFS)).toEqual([
      { captionId: 'cap-sale' },
      { captionId: 'cap-hello' },
    ]);
    expect(resolveAskChoices('how_long', ['2', '2.5'], FIXTURE_REFS)).toEqual([2, 2.5]);
    expect(resolveAskChoices('where_caption', ['start', 'whole'], FIXTURE_REFS)).toEqual(['start', 'whole']);
    expect(resolveAskChoices('which_clip', ['c1', 'c9'], FIXTURE_REFS)).toBeNull();
  });
});

describe('applyEditSteps — each step kind on the four-cut fixture', () => {
  it('trims by what to keep, in played seconds, on a plain, an already trimmed and a 2x cut', () => {
    expect(cuts(ok([{ do: 'trim', clip: 'c1', keep: 'start', seconds: 2 }]))[0]).toEqual(['clip-open', 0, 2]);
    expect(cuts(ok([{ do: 'trim', clip: 'c1', keep: 'end', seconds: 2 }]))[0]).toEqual(['clip-open', 3, 5]);
    expect(cuts(ok([{ do: 'trim', clip: 'c1', keep: 'middle', seconds: 3 }]))[0]).toEqual(['clip-open', 1, 4]);
    expect(cuts(ok([{ do: 'trim', clip: 'c1', keep: 'range', from: 1, to: 4 }]))[0]).toEqual(['clip-open', 1, 4]);

    // c2 already plays media 1–6: played second 0 is media second 1.
    expect(cuts(ok([{ do: 'trim', clip: 'c2', keep: 'start', seconds: 2 }]))[1]).toEqual(['clip-hand', 1, 3]);
    expect(cuts(ok([{ do: 'trim', clip: 'c2', keep: 'end', seconds: 2 }]))[1]).toEqual(['clip-hand', 4, 6]);
    expect(cuts(ok([{ do: 'trim', clip: 'c2', keep: 'range', from: 0.5, to: 2.5 }]))[1]).toEqual(['clip-hand', 1.5, 3.5]);

    // c3 plays at 2x: two played seconds are four media seconds.
    const fast = ok([{ do: 'trim', clip: 'c3', keep: 'start', seconds: 2 }]);
    expect(cuts(fast)[2]).toEqual(['clip-run', 0, 4]);
    expect(projectDurationSec(fast)).toBe(16);
    expect(cuts(ok([{ do: 'trim', clip: 'c3', keep: 'end', seconds: 1.5 }]))[2]).toEqual(['clip-run', 9, 12]);
    expect(cuts(ok([{ do: 'trim', clip: 'c3', keep: 'middle', seconds: 2 }]))[2]).toEqual(['clip-run', 4, 8]);
    expect(cuts(ok([{ do: 'trim', clip: 'c3', keep: 'range', from: 1, to: 2.5 }]))[2]).toEqual(['clip-run', 2, 5]);
  });

  it('refuses a trim outside the cut or shorter than the minimum', () => {
    expect(run([{ do: 'trim', clip: 'c1', keep: 'start', seconds: 6 }]).problems).toEqual([
      { step: 0, code: 'range_outside_cut' },
    ]);
    expect(run([{ do: 'trim', clip: 'c1', keep: 'range', from: 4, to: 6 }]).problems).toEqual([
      { step: 0, code: 'range_outside_cut' },
    ]);
    expect(run([{ do: 'trim', clip: 'c1', keep: 'start', seconds: 0.2 }]).problems).toEqual([
      { step: 0, code: 'too_short' },
    ]);
  });

  it('splits at played seconds, gives the second piece a stable id and lets later steps name the pieces', () => {
    const split = ok([{ do: 'split', clip: 'c3', at: 2 }]);
    expect(cuts(split)).toEqual([
      ['clip-open', 0, 5],
      ['clip-hand', 1, 6],
      ['clip-run', 0, 4],
      ['clip-run-b', 4, 12],
      ['clip-logo', 0, 4],
    ]);
    expect(projectDurationSec(split)).toBe(20);

    const thenTrim = ok([
      { do: 'split', clip: 'c3', at: 2 },
      { do: 'trim', clip: 'c3b', keep: 'start', seconds: 1 },
    ]);
    expect(cuts(thenTrim)[3]).toEqual(['clip-run-b', 4, 6]);

    const twice = ok([
      { do: 'split', clip: 'c3', at: 2 },
      { do: 'split', clip: 'c3b', at: 1 },
    ]);
    expect(cuts(twice).map(([id]) => id)).toEqual(['clip-open', 'clip-hand', 'clip-run', 'clip-run-b', 'clip-run-b-b', 'clip-logo']);

    expect(run([{ do: 'split', clip: 'c1', at: 0.2 }]).problems).toEqual([{ step: 0, code: 'too_short' }]);
    expect(run([{ do: 'split', clip: 'c1', at: 5 }]).problems).toEqual([{ step: 0, code: 'range_outside_cut' }]);
    expect(run([{ do: 'trim', clip: 'c2b', keep: 'start', seconds: 1 }]).problems).toEqual([
      { step: 0, code: 'target_missing' },
    ]);
  });

  it('refuses a split when the timeline is full', () => {
    const base = assistFixture();
    const full: ComposerProject = {
      ...base,
      clips: Array.from({ length: MAX_COMPOSE_CLIPS }, (_, i) => ({ ...base.clips[0]!, id: `full-${i}` })),
    };
    const result = applyEditSteps(full, [{ do: 'split', clip: { clipId: 'full-3' }, at: 2 }]);
    expect(result.problems).toEqual([{ step: 0, code: 'clip_limit' }]);
    expect(result.project).toBe(full);
  });

  it('removes and moves cuts', () => {
    expect(cuts(ok([{ do: 'remove', clip: 'c2' }])).map(([id]) => id)).toEqual(['clip-open', 'clip-run', 'clip-logo']);
    const order = (steps: EditStep[]) => cuts(ok(steps)).map(([id]) => id);
    expect(order([{ do: 'move', clip: 'c4', to: 'first' }])).toEqual(['clip-logo', 'clip-open', 'clip-hand', 'clip-run']);
    expect(order([{ do: 'move', clip: 'c1', to: 'last' }])).toEqual(['clip-hand', 'clip-run', 'clip-logo', 'clip-open']);
    expect(order([{ do: 'move', clip: 'c1', to: { after: 'c3' } }])).toEqual(['clip-hand', 'clip-run', 'clip-open', 'clip-logo']);
    expect(order([{ do: 'move', clip: 'c4', to: { before: 'c2' } }])).toEqual(['clip-open', 'clip-logo', 'clip-hand', 'clip-run']);
    expect(order([{ do: 'move', clip: 'c2', to: { before: 'c1' } }])).toEqual(['clip-hand', 'clip-open', 'clip-run', 'clip-logo']);
    // Already first: nothing changes, so the plan as a whole changes nothing.
    expect(run([{ do: 'move', clip: 'c1', to: 'first' }]).problems).toEqual([{ step: null, code: 'no_change' }]);
  });

  it('sets cut sound and music', () => {
    const muted = ok([{ do: 'sound', target: 'c2', muted: true }]);
    expect(muted.clips[1]).toMatchObject({ id: 'clip-hand', muted: true, volume: 1 });
    expect(ok([{ do: 'sound', target: 'all_clips', muted: true }]).clips.every((c) => c.muted)).toBe(true);
    expect(ok([{ do: 'sound', target: 'c3', volume: 0.5 }]).clips[2]).toMatchObject({ volume: 0.5, muted: false });
    expect(ok([{ do: 'sound', target: 'c4', muted: false }]).clips[3]).toMatchObject({ volume: 1, muted: false });

    expect(ok([{ do: 'sound', target: 'music', volume: 0.3 }]).bgm?.volume).toBe(0.3);
    expect(ok([{ do: 'sound', target: 'music', muted: true }]).bgm?.volume).toBe(0);
    expect(ok([{ do: 'sound', target: 'music', remove: true }]).bgm).toBeNull();
    expect(run([{ do: 'sound', target: 'music', muted: false }]).problems).toEqual([{ step: null, code: 'no_change' }]);

    const silent = { ...assistFixture(), bgm: null };
    expect(run([{ do: 'sound', target: 'music', volume: 0.3 }], silent).problems).toEqual([{ step: 0, code: 'no_music' }]);
  });

  it('adds captions at the start, the end, the whole video, a cut or a range', () => {
    const at = (steps: EditStep[]) => ok(steps).captions.at(-1);
    expect(at([{ do: 'caption_add', text: '지금 만나보세요', where: 'end' }])).toEqual({
      id: 'ea-cap-1',
      text: '지금 만나보세요',
      startSec: 17.5,
      endSec: 20,
      position: 'bottom',
      size: 'md',
    });
    expect(at([{ do: 'caption_add', text: 'a', where: 'start', seconds: 3 }])).toMatchObject({ startSec: 0, endSec: 3 });
    expect(at([{ do: 'caption_add', text: 'a', where: 'whole', position: 'top', size: 'sm' }])).toMatchObject({
      startSec: 0,
      endSec: 20,
      position: 'top',
      size: 'sm',
    });
    expect(at([{ do: 'caption_add', text: 'a', where: { clip: 'c3' } }])).toMatchObject({ startSec: 10, endSec: 16 });
    expect(at([{ do: 'caption_add', text: 'a', where: { clip: 'c3' }, seconds: 2 }])).toMatchObject({ startSec: 10, endSec: 12 });
    expect(at([{ do: 'caption_add', text: 'a', where: { from: 5, to: 8 } }])).toMatchObject({ startSec: 5, endSec: 8 });

    const two = ok([
      { do: 'caption_add', text: 'a', where: 'start' },
      { do: 'caption_add', text: 'b', where: 'end' },
    ]);
    expect(two.captions.map((c) => c.id)).toEqual(['cap-hello', 'cap-sale', 'ea-cap-1', 'ea-cap-2']);

    expect(run([{ do: 'caption_add', text: 'a', where: { from: 25, to: 27 } }]).problems).toEqual([
      { step: 0, code: 'outside_timeline' },
    ]);

    const crowded: ComposerProject = {
      ...assistFixture(),
      captions: Array.from({ length: MAX_COMPOSE_CAPTIONS }, (_, i) => ({
        id: `cap-${i}`,
        text: `${i}`,
        startSec: 0,
        endSec: 1,
        position: 'bottom' as const,
        size: 'md' as const,
      })),
    };
    expect(run([{ do: 'caption_add', text: 'a', where: 'start' }], crowded).problems).toEqual([
      { step: 0, code: 'caption_limit' },
    ]);
  });

  it('edits and removes captions by id', () => {
    expect(ok([{ do: 'caption_edit', caption: 't1', position: 'top' }]).captions[0]).toMatchObject({
      id: 'cap-hello',
      position: 'top',
      text: '봄 신상 출시',
    });
    expect(ok([{ do: 'caption_edit', caption: 't2', text: '오늘만 30% 할인' }]).captions[1]?.text).toBe('오늘만 30% 할인');
    expect(ok([{ do: 'caption_edit', caption: 't1', from: 1, to: 3 }]).captions[0]).toMatchObject({ startSec: 1, endSec: 3 });
    expect(run([{ do: 'caption_edit', caption: 't1', position: 'bottom' }]).problems).toEqual([
      { step: null, code: 'no_change' },
    ]);
    expect(ok([{ do: 'caption_remove', caption: 't2' }]).captions.map((c) => c.id)).toEqual(['cap-hello']);
    expect(ok([{ do: 'caption_remove', caption: 'all' }]).captions).toEqual([]);
  });

  it('changes the aspect and the look', () => {
    expect(ok([{ do: 'aspect', aspect: '16:9' }]).aspect).toBe('16:9');
    expect(run([{ do: 'aspect', aspect: '9:16' }]).problems).toEqual([{ step: null, code: 'no_change' }]);

    const warm = ok([{ do: 'look', preset: 'kodak-2383-warm', strength: 0.6 }]);
    expect(warm.colorGrade).toMatchObject({ enabled: true, scope: 'full_timeline', presetId: 'kodak-2383-warm', intensity: 0.6 });
    expect(ok([{ do: 'look', preset: 'off' }], warm).colorGrade).toBeNull();
    expect(run([{ do: 'look', preset: 'off' }]).problems).toEqual([{ step: null, code: 'no_change' }]);
  });
});

describe('applyEditSteps — targets by id, not by position', () => {
  it('trims the original second cut after the first one is removed', () => {
    const project = ok([
      { do: 'remove', clip: 'c1' },
      { do: 'trim', clip: 'c2', keep: 'start', seconds: 2 },
    ]);
    expect(cuts(project)).toEqual([
      ['clip-hand', 1, 3],
      ['clip-run', 0, 12],
      ['clip-logo', 0, 4],
    ]);
  });

  it('trims a cut after it moved', () => {
    const project = ok([
      { do: 'move', clip: 'c4', to: 'first' },
      { do: 'trim', clip: 'c4', keep: 'start', seconds: 1 },
    ]);
    expect(cuts(project)[0]).toEqual(['clip-logo', 0, 1]);
    expect(cuts(project)[3]).toEqual(['clip-run', 0, 12]);
  });

  it('trims the second piece of a split cut', () => {
    const project = ok([
      { do: 'split', clip: 'c2', at: 2 },
      { do: 'trim', clip: 'c2b', keep: 'start', seconds: 1 },
    ]);
    expect(cuts(project).slice(1, 3)).toEqual([
      ['clip-hand', 1, 3],
      ['clip-hand-b', 3, 4],
    ]);
  });
});

describe('applyEditSteps — all or nothing', () => {
  it('returns the original project and every problem when any step fails', () => {
    const project = assistFixture();
    const result = run(
      [
        { do: 'trim', clip: 'c1', keep: 'start', seconds: 2 },
        { do: 'trim', clip: 'c2', keep: 'start', seconds: 9 },
        { do: 'remove', clip: 'c4' },
        { do: 'caption_add', text: 'a', where: { from: 40, to: 41 } },
      ],
      project,
    );
    expect(result.project).toBe(project);
    expect(result.problems).toEqual([
      { step: 1, code: 'range_outside_cut' },
      { step: 3, code: 'outside_timeline' },
    ]);
  });

  it('accepts a step that is already true when another step changes something', () => {
    const result = run([
      { do: 'sound', target: 'c4', muted: true },
      { do: 'sound', target: 'c1', muted: true },
    ]);
    expect(result.problems).toEqual([]);
    expect(result.project.clips.map((c) => c.muted)).toEqual([true, false, false, true]);
  });

  it('reports no_change when the whole plan changes nothing', () => {
    const project = assistFixture();
    const result = run([{ do: 'sound', target: 'c4', muted: true }], project);
    expect(result).toEqual({ project, problems: [{ step: null, code: 'no_change' }] });
  });
});

describe('fit_total', () => {
  it('shortens tails in proportion and lands exactly on the target', () => {
    const project = ok([{ do: 'fit_total', seconds: 15 }]);
    // 5 s to lose from 5 / 5 / 6 / 4 s: 1.25 / 1.25 / 1.5 / 1.0, the spare tenth goes to the first tie.
    expect(cuts(project)).toEqual([
      ['clip-open', 0, 3.7],
      ['clip-hand', 1, 4.8],
      ['clip-run', 0, 9],
      ['clip-logo', 0, 3],
    ]);
    expect(projectDurationSec(project)).toBe(15);
  });

  it('keeps protected cuts as they are', () => {
    const project = ok([{ do: 'fit_total', seconds: 10, protect: ['c4'] }]);
    expect(cuts(project)).toEqual([
      ['clip-open', 0, 1.9],
      ['clip-hand', 1, 2.9],
      ['clip-run', 0, 4.4],
      ['clip-logo', 0, 4],
    ]);
    expect(projectDurationSec(project)).toBe(10);
  });

  it('stops every cut at one second, and leaves a cut that is already shorter alone', () => {
    const floor = ok([{ do: 'fit_total', seconds: 4 }]);
    expect(floor.clips.map((c) => c.trimEndSec - c.trimStartSec)).toEqual([1, 1, 2, 1]);
    expect(projectDurationSec(floor)).toBe(4);

    const base = assistFixture();
    const short: ComposerProject = {
      ...base,
      clips: [{ ...base.clips[0]!, trimEndSec: 0.6 }, base.clips[1]!],
    };
    const shortFit = applyEditSteps(short, [{ do: 'fit_total', seconds: 3 }]);
    expect(shortFit.problems).toEqual([]);
    expect(cuts(shortFit.project)).toEqual([
      ['clip-open', 0, 0.6],
      ['clip-hand', 1, 3.4],
    ]);
  });

  it('refuses a target it cannot reach, a longer target, and a plan with every cut protected', () => {
    expect(run([{ do: 'fit_total', seconds: 3.9 }]).problems).toEqual([{ step: 0, code: 'not_possible' }]);
    expect(run([{ do: 'fit_total', seconds: 25 }]).problems).toEqual([{ step: 0, code: 'not_possible' }]);
    expect(
      run([{ do: 'fit_total', seconds: 10, protect: ['c1', 'c2', 'c3', 'c4'] }]).problems,
    ).toEqual([{ step: 0, code: 'not_possible' }]);
    expect(run([{ do: 'fit_total', seconds: 20 }]).problems).toEqual([{ step: null, code: 'no_change' }]);
  });
});

describe('even_pace', () => {
  it('cuts every longer cut down to its first N played seconds', () => {
    const project = ok([{ do: 'even_pace', secondsPerClip: 3 }]);
    expect(cuts(project)).toEqual([
      ['clip-open', 0, 3],
      ['clip-hand', 1, 4],
      ['clip-run', 0, 6],
      ['clip-logo', 0, 3],
    ]);
    expect(projectDurationSec(project)).toBe(12);
  });

  it('leaves shorter cuts and refuses when nothing would change', () => {
    expect(cuts(ok([{ do: 'even_pace', secondsPerClip: 5 }]))[2]).toEqual(['clip-run', 0, 10]);
    expect(run([{ do: 'even_pace', secondsPerClip: 6 }]).problems).toEqual([{ step: 0, code: 'no_change' }]);
  });
});

describe('purity', () => {
  const EVERY_KIND: EditStep[][] = [
    [{ do: 'trim', clip: 'c3', keep: 'middle', seconds: 2 }],
    [{ do: 'split', clip: 'c2', at: 2 }, { do: 'remove', clip: 'c2a' }],
    [{ do: 'move', clip: 'c1', to: { after: 'c4' } }],
    [{ do: 'sound', target: 'all_clips', volume: 0.4 }, { do: 'sound', target: 'music', remove: true }],
    [{ do: 'caption_add', text: 'x', where: { clip: 'c2' } }, { do: 'caption_edit', caption: 't1', text: 'y' }],
    [{ do: 'caption_remove', caption: 'all' }, { do: 'aspect', aspect: '1:1' }],
    [{ do: 'look', preset: 'moody-teal-amber' }],
    [{ do: 'fit_total', seconds: 12 }],
    [{ do: 'even_pace', secondsPerClip: 2 }],
  ];

  it('never writes to the input project', () => {
    for (const steps of EVERY_KIND) {
      const frozen = deepFreeze(assistFixture());
      const result = run(steps, frozen);
      expect(result.problems, JSON.stringify(steps)).toEqual([]);
      expect(frozen).toEqual(assistFixture());
    }
  });

  it('gives the same output for the same input', () => {
    const steps: EditStep[] = [
      { do: 'split', clip: 'c3', at: 2 },
      { do: 'caption_add', text: '지금 만나보세요', where: 'end' },
      { do: 'fit_total', seconds: 14, protect: ['c3a'] },
      { do: 'move', clip: 'c3b', to: 'first' },
    ];
    const first = run(steps);
    const second = run(steps);
    expect(first.problems).toEqual([]);
    expect(JSON.stringify(first.project)).toBe(JSON.stringify(second.project));
  });
});
