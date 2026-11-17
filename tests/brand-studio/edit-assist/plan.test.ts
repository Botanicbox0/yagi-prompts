import { describe, expect, it } from 'vitest';
import {
  EDIT_PLAN_MODEL_SCHEMA,
  EDIT_STEP_KINDS,
  EditPlanSchema,
  EditStepSchema,
  parseEditPlan,
  type EditStep,
} from '@/lib/brand-studio/edit-assist/plan';

const ONE_OF_EACH: EditStep[] = [
  { do: 'trim', clip: 'c2', keep: 'start', seconds: 2 },
  { do: 'trim', clip: 'c2', keep: 'range', from: 0.5, to: 2.5 },
  { do: 'split', clip: 'c3', at: 1.5 },
  { do: 'remove', clip: 'c3b' },
  { do: 'move', clip: 'c4', to: 'first' },
  { do: 'move', clip: 'c1', to: { after: 'c3' } },
  { do: 'sound', target: 'music', volume: 0.3 },
  { do: 'sound', target: 'all_clips', muted: true },
  { do: 'sound', target: 'music', remove: true },
  { do: 'caption_add', text: '지금 만나보세요', where: 'end', seconds: 2, position: 'bottom', size: 'lg' },
  { do: 'caption_add', text: 'Shop now', where: { clip: 'c2a' } },
  { do: 'caption_add', text: '한정 수량', where: { from: 5, to: 8 } },
  { do: 'caption_edit', caption: 't1', position: 'top' },
  { do: 'caption_remove', caption: 'all' },
  { do: 'aspect', aspect: '16:9' },
  { do: 'look', preset: 'kodak-2383-warm', strength: 0.6 },
  { do: 'look', preset: 'off' },
  { do: 'fit_total', seconds: 15, protect: ['c4'] },
  { do: 'even_pace', secondsPerClip: 2 },
];

describe('EditStepSchema', () => {
  it('accepts every step kind', () => {
    const kinds = new Set<string>();
    for (const step of ONE_OF_EACH) {
      const parsed = EditStepSchema.safeParse(step);
      expect(parsed.success, JSON.stringify(step)).toBe(true);
      kinds.add(step.do);
    }
    expect([...kinds].sort()).toEqual([...EDIT_STEP_KINDS].sort());
  });

  it.each([
    ['unknown key', { do: 'remove', clip: 'c1', why: 'because' }],
    ['unknown kind', { do: 'speed', clip: 'c1', rate: 2 }],
    ['bad clip ref', { do: 'remove', clip: 'clip-open' }],
    ['piece of a piece', { do: 'remove', clip: 'c2ab' }],
    ['caption ref as clip', { do: 'remove', clip: 't1' }],
    ['trim start without seconds', { do: 'trim', clip: 'c1', keep: 'start' }],
    ['trim range without to', { do: 'trim', clip: 'c1', keep: 'range', from: 1 }],
    ['trim range with seconds', { do: 'trim', clip: 'c1', keep: 'range', from: 1, to: 2, seconds: 1 }],
    ['trim range reversed', { do: 'trim', clip: 'c1', keep: 'range', from: 3, to: 2 }],
    ['trim start with from', { do: 'trim', clip: 'c1', keep: 'start', seconds: 2, from: 0 }],
    ['negative seconds', { do: 'trim', clip: 'c1', keep: 'end', seconds: -1 }],
    ['split at 0', { do: 'split', clip: 'c1', at: 0 }],
    ['move before itself', { do: 'move', clip: 'c1', to: { before: 'c1' } }],
    ['move to a number', { do: 'move', clip: 'c1', to: 2 }],
    ['move with extra key', { do: 'move', clip: 'c1', to: { before: 'c2', after: 'c3' } }],
    ['sound with nothing', { do: 'sound', target: 'c1' }],
    ['remove clip sound', { do: 'sound', target: 'c1', remove: true }],
    ['remove music with volume', { do: 'sound', target: 'music', remove: true, volume: 0.2 }],
    ['volume above 1', { do: 'sound', target: 'music', volume: 1.5 }],
    ['empty caption', { do: 'caption_add', text: '   ', where: 'start' }],
    ['caption over 80', { do: 'caption_add', text: 'x'.repeat(81), where: 'start' }],
    ['caption range reversed', { do: 'caption_add', text: 'a', where: { from: 5, to: 3 } }],
    ['caption range with seconds', { do: 'caption_add', text: 'a', where: { from: 1, to: 3 }, seconds: 2 }],
    ['caption whole with seconds', { do: 'caption_add', text: 'a', where: 'whole', seconds: 2 }],
    ['caption edit with nothing', { do: 'caption_edit', caption: 't1' }],
    ['caption edit bad ref', { do: 'caption_edit', caption: 'c1', text: 'a' }],
    ['bad aspect', { do: 'aspect', aspect: '21:9' }],
    ['unknown preset', { do: 'look', preset: 'teal-orange' }],
    ['off with strength', { do: 'look', preset: 'off', strength: 0.5 }],
    ['even pace below minimum', { do: 'even_pace', secondsPerClip: 0.1 }],
    ['fit total zero', { do: 'fit_total', seconds: 0 }],
  ])('rejects %s', (_label, step) => {
    expect(EditStepSchema.safeParse(step).success).toBe(false);
  });
});

describe('EditPlanSchema', () => {
  it('accepts a plan, an ask and a cannot', () => {
    expect(EditPlanSchema.safeParse({ kind: 'plan', steps: ONE_OF_EACH.slice(0, 12) }).success).toBe(true);
    expect(EditPlanSchema.safeParse({ kind: 'ask', about: 'which_clip', choices: ['c1', 'c2', 'all'] }).success).toBe(true);
    expect(EditPlanSchema.safeParse({ kind: 'ask', about: 'which_caption', choices: ['t1', 't2'] }).success).toBe(true);
    expect(EditPlanSchema.safeParse({ kind: 'ask', about: 'how_long', choices: ['2', '2.5', '3'] }).success).toBe(true);
    expect(EditPlanSchema.safeParse({ kind: 'ask', about: 'where_caption', choices: ['start', 'end', 'whole'] }).success).toBe(true);
    expect(EditPlanSchema.safeParse({ kind: 'cannot', reason: 'not_timeline_edit' }).success).toBe(true);
  });

  it('rejects more than 12 steps, an empty plan and unknown keys', () => {
    const thirteen = Array.from({ length: 13 }, () => ({ do: 'aspect', aspect: '1:1' }));
    expect(EditPlanSchema.safeParse({ kind: 'plan', steps: thirteen }).success).toBe(false);
    expect(EditPlanSchema.safeParse({ kind: 'plan', steps: [] }).success).toBe(false);
    expect(EditPlanSchema.safeParse({ kind: 'plan', steps: [{ do: 'aspect', aspect: '1:1' }], note: 'done' }).success).toBe(false);
    expect(EditPlanSchema.safeParse({ kind: 'cannot', reason: 'not_timeline_edit', message: 'sorry' }).success).toBe(false);
  });

  it.each([
    ['prose choice', { kind: 'ask', about: 'which_clip', choices: ['the first one', 'c2'] }],
    ['caption ref for a clip', { kind: 'ask', about: 'which_clip', choices: ['t1', 'c2'] }],
    ['split piece as a choice', { kind: 'ask', about: 'which_clip', choices: ['c2a', 'c2b'] }],
    ['clip ref for a caption', { kind: 'ask', about: 'which_caption', choices: ['c1', 't2'] }],
    ['non-number seconds', { kind: 'ask', about: 'how_long', choices: ['2s', '3'] }],
    ['zero seconds', { kind: 'ask', about: 'how_long', choices: ['0', '3'] }],
    ['unknown place', { kind: 'ask', about: 'where_caption', choices: ['start', 'middle'] }],
    ['one choice', { kind: 'ask', about: 'which_clip', choices: ['c1'] }],
    ['five choices', { kind: 'ask', about: 'which_clip', choices: ['c1', 'c2', 'c3', 'c4', 'all'] }],
    ['duplicates', { kind: 'ask', about: 'which_clip', choices: ['c1', 'c1'] }],
    ['a question sentence', { kind: 'ask', about: 'which_clip', question: '어느 컷?', choices: ['c1', 'c2'] }],
    ['unknown reason', { kind: 'cannot', reason: 'too_hard' }],
  ])('rejects an ask or cannot with %s', (_label, plan) => {
    expect(EditPlanSchema.safeParse(plan).success).toBe(false);
  });
});

describe('parseEditPlan', () => {
  it('drops nulls and empty arrays a flat answer schema invites, nothing else', () => {
    const tidy = parseEditPlan({
      kind: 'ask',
      about: 'which_clip',
      choices: ['c1', 'c2'],
      steps: [],
      reason: null,
    });
    expect(tidy).toEqual({ ok: true, plan: { kind: 'ask', about: 'which_clip', choices: ['c1', 'c2'] } });

    const nullsInSteps = parseEditPlan({
      kind: 'plan',
      steps: [{ do: 'remove', clip: 'c1', keep: null, seconds: null }],
    });
    expect(nullsInSteps).toEqual({ ok: true, plan: { kind: 'plan', steps: [{ do: 'remove', clip: 'c1' }] } });

    const stillStrict = parseEditPlan({ kind: 'plan', steps: [{ do: 'remove', clip: 'c1', keep: 'start' }] });
    expect(stillStrict.ok).toBe(false);
  });

  it('describes what failed as short machine lines', () => {
    const failed = parseEditPlan({ kind: 'plan', steps: [{ do: 'trim', clip: 'c1', keep: 'start' }] });
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.problems.length).toBeGreaterThan(0);
      expect(failed.problems[0]).toMatch(/^schema steps\.0/);
    }
    expect(parseEditPlan('not json').ok).toBe(false);
  });

  it('gives the model a flat step schema with every kind and every field name the steps use', () => {
    const steps = (EDIT_PLAN_MODEL_SCHEMA.properties as Record<string, { items: { properties: Record<string, unknown> } }>).steps!;
    const fields = Object.keys(steps.items.properties);
    for (const step of ONE_OF_EACH) {
      for (const key of Object.keys(step)) expect(fields).toContain(key);
    }
    expect((steps.items.properties.do as { enum: string[] }).enum).toEqual([...EDIT_STEP_KINDS]);
  });
});
