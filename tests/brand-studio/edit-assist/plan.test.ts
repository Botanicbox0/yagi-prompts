import { describe, expect, it } from 'vitest';
import {
  EDIT_PLAN_MODEL_SCHEMA,
  EDIT_STEP_KINDS,
  EditPlanSchema,
  EditStepSchema,
  STEP_KEY_ORDER,
  editPlanFromWire,
  editPlanToWire,
  parseEditPlan,
  parseModelReply,
  type EditPlan,
  type EditStep,
} from '@/lib/brand-studio/edit-assist/plan';
import { EDIT_ASSIST_SYSTEM } from '@/lib/brand-studio/edit-assist/service';
import { EDIT_ASSIST_CASES } from './cases';

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

    const emptyInStep = parseEditPlan({ kind: 'plan', steps: [{ do: 'fit_total', seconds: 15, protect: [] }] });
    expect(emptyInStep).toEqual({ ok: true, plan: { kind: 'plan', steps: [{ do: 'fit_total', seconds: 15 }] } });
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

});

/* ------------------------------------------------------------ the model schema */

const stepProperties = () =>
  (EDIT_PLAN_MODEL_SCHEMA.properties as Record<string, { items: { properties: Record<string, unknown> } }>).steps!.items
    .properties;

/** Keys of `keys` appear in `order` and in the same relative order. */
function inOrder(keys: readonly string[], order: readonly string[]): boolean {
  const positions = keys.map((key) => order.indexOf(key));
  return positions.every((p, i) => p >= 0 && (i === 0 || p > positions[i - 1]!));
}

/** Every `{"do":...}` step example in the system instruction (wire steps hold no nested objects). */
function promptStepExamples(): Array<Record<string, unknown>> {
  return (EDIT_ASSIST_SYSTEM.match(/\{"do":[^{}]*\}/g) ?? []).map((text) => JSON.parse(text) as Record<string, unknown>);
}

/**
 * Measured on gemini-4-hydrogen (2026-11-18): this schema at 1,452 characters was accepted; the old one
 * at 1,435 was refused because of `maxItems` on the step array, so length alone does not decide — the
 * shape rules below do. The budget only stops the schema from quietly growing.
 */
const MODEL_SCHEMA_JSON_BUDGET = 1_500;

describe('EDIT_PLAN_MODEL_SCHEMA', () => {
  it('has none of what makes the API refuse a schema for too many states', () => {
    const banned = new Set([
      'anyOf',
      'oneOf',
      'allOf',
      'not',
      'minItems',
      'maxItems',
      'pattern',
      'format',
      'minimum',
      'maximum',
      'exclusiveMinimum',
      'exclusiveMaximum',
      'minLength',
      'maxLength',
      '$ref',
      '$defs',
    ]);
    const walk = (node: unknown, path: string) => {
      if (!node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node)) {
        if (path.endsWith('.properties')) {
          // A property's schema: never open (`{}` accepts any JSON value).
          expect((value as { type?: unknown }).type, `${path}.${key}`).toBeTypeOf('string');
        } else {
          expect(banned.has(key), `${path}.${key}`).toBe(false);
        }
        walk(value, `${path}.${key}`);
      }
    };
    walk(EDIT_PLAN_MODEL_SCHEMA, 'schema');
    expect(JSON.stringify(EDIT_PLAN_MODEL_SCHEMA).length).toBeLessThanOrEqual(MODEL_SCHEMA_JSON_BUDGET);
  });

  it('keeps enums to a few short words: no colour-preset list', () => {
    const enums: string[][] = [];
    const walk = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray((node as { enum?: unknown }).enum)) enums.push((node as { enum: string[] }).enum);
      Object.values(node).forEach(walk);
    };
    walk(EDIT_PLAN_MODEL_SCHEMA);
    // The longest is "not_timeline_edit" (17); colour-preset ids run to 24.
    for (const values of enums) for (const value of values) expect(value.length, value).toBeLessThanOrEqual(20);
    expect(stepProperties().preset).toEqual({ type: 'string' });
    expect((stepProperties().do as { enum: string[] }).enum).toEqual([...EDIT_STEP_KINDS]);
  });

  it('lists the step keys in STEP_KEY_ORDER, the order the model must write them in', () => {
    expect(Object.keys(stepProperties())).toEqual([...STEP_KEY_ORDER]);
  });

  it('writes every step example in the system instruction in schema key order, and each one is valid', () => {
    const examples = promptStepExamples();
    expect(new Set(examples.map((e) => e.do))).toEqual(new Set(EDIT_STEP_KINDS));
    for (const example of examples) {
      expect(inOrder(Object.keys(example), STEP_KEY_ORDER), JSON.stringify(example)).toBe(true);
      expect(parseModelReply({ kind: 'plan', steps: [example] }).ok, JSON.stringify(example)).toBe(true);
    }
  });

  it('can carry every step of every kind, each key in schema order', () => {
    for (const step of ONE_OF_EACH) {
      const [wire] = editPlanToWire({ kind: 'plan', steps: [step] }).steps as Array<Record<string, unknown>>;
      const keys = Object.keys(wire!);
      for (const key of keys) expect(STEP_KEY_ORDER as readonly string[]).toContain(key);
      // Written in schema order, the same step still parses: the converter does not depend on key order.
      const ordered = Object.fromEntries(STEP_KEY_ORDER.filter((k) => k in wire!).map((k) => [k, wire![k]]));
      expect(parseModelReply({ kind: 'plan', steps: [ordered] }), JSON.stringify(step)).toEqual({
        ok: true,
        plan: { kind: 'plan', steps: [step] },
      });
    }
  });
});

/* ---------------------------------------------------------- wire → EditPlan */

const wirePlan = (...steps: Array<Record<string, unknown>>) => ({ kind: 'plan', steps });
const parsedSteps = (...steps: EditStep[]) => ({ ok: true, plan: { kind: 'plan', steps } });

describe('parseModelReply (wire → EditPlan → strict validation)', () => {
  it('reads every step kind in its wire form', () => {
    for (const step of ONE_OF_EACH) {
      expect(parseModelReply(editPlanToWire({ kind: 'plan', steps: [step] })), JSON.stringify(step)).toEqual(
        parsedSteps(step),
      );
    }
  });

  it('turns move place / anchor into the destination', () => {
    expect(parseModelReply(wirePlan({ do: 'move', clip: 'c4', place: 'first' }))).toEqual(
      parsedSteps({ do: 'move', clip: 'c4', to: 'first' }),
    );
    expect(parseModelReply(wirePlan({ do: 'move', clip: 'c1', place: 'last' }))).toEqual(
      parsedSteps({ do: 'move', clip: 'c1', to: 'last' }),
    );
    expect(parseModelReply(wirePlan({ do: 'move', clip: 'c3', place: 'before', anchor: 'c1' }))).toEqual(
      parsedSteps({ do: 'move', clip: 'c3', to: { before: 'c1' } }),
    );
    expect(parseModelReply(wirePlan({ do: 'move', clip: 'c1', place: 'after', anchor: 'c2b' }))).toEqual(
      parsedSteps({ do: 'move', clip: 'c1', to: { after: 'c2b' } }),
    );
  });

  it('turns sound target "clip" + clip into the cut ref', () => {
    expect(parseModelReply(wirePlan({ do: 'sound', target: 'clip', clip: 'c2', muted: true }))).toEqual(
      parsedSteps({ do: 'sound', target: 'c2', muted: true }),
    );
    expect(parseModelReply(wirePlan({ do: 'sound', target: 'all_clips', volume: 0.5 }))).toEqual(
      parsedSteps({ do: 'sound', target: 'all_clips', volume: 0.5 }),
    );
    expect(parseModelReply(wirePlan({ do: 'sound', target: 'music', remove: true }))).toEqual(
      parsedSteps({ do: 'sound', target: 'music', remove: true }),
    );
  });

  it('turns caption_add where "clip" / "range" into the place object', () => {
    for (const where of ['start', 'end', 'whole'] as const) {
      expect(parseModelReply(wirePlan({ do: 'caption_add', where, text: '한정판' }))).toEqual(
        parsedSteps({ do: 'caption_add', text: '한정판', where }),
      );
    }
    expect(parseModelReply(wirePlan({ do: 'caption_add', where: 'clip', clip: 'c3', seconds: 2, text: '도시를 달리다' }))).toEqual(
      parsedSteps({ do: 'caption_add', text: '도시를 달리다', where: { clip: 'c3' }, seconds: 2 }),
    );
    expect(parseModelReply(wirePlan({ do: 'caption_add', where: 'range', from: 5, to: 8, text: '한정 수량', size: 'lg' }))).toEqual(
      parsedSteps({ do: 'caption_add', text: '한정 수량', where: { from: 5, to: 8 }, size: 'lg' }),
    );
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['before without anchor', { do: 'move', clip: 'c1', place: 'before' }, 'schema steps.0.anchor: place_needs_anchor'],
    ['first with an anchor', { do: 'move', clip: 'c1', place: 'first', anchor: 'c2' }, 'schema steps.0.anchor: anchor_only_with_before_or_after'],
    ['place and to', { do: 'move', clip: 'c1', place: 'first', to: 'last' }, 'schema steps.0.place: place_and_to'],
    ['an unknown place', { do: 'move', clip: 'c1', place: 'middle' }, 'schema steps.0.place: unknown_place'],
    ['target clip without clip', { do: 'sound', target: 'clip', muted: true, position: 'bottom' }, 'schema steps.0.clip: target_clip_needs_clip_ref'],
    ['target clip naming a caption', { do: 'sound', target: 'clip', clip: 't1', muted: true }, 'schema steps.0.clip: target_clip_needs_clip_ref'],
    // The live answer that found the key-order trap: the cut ref in `caption`, padding in `secondsPerClip`.
    [
      'where clip with the ref in caption',
      { do: 'caption_add', text: '도시를 달리다', where: 'clip', caption: 'c3', secondsPerClip: 0 },
      'schema steps.0.clip: where_clip_needs_clip',
    ],
    ['where range without to', { do: 'caption_add', where: 'range', from: 3, text: 'a' }, 'schema steps.0.from: where_range_needs_from_and_to'],
  ])('names the wire problem: %s', (_label, step, problem) => {
    expect(parseModelReply(wirePlan(step))).toEqual({ ok: false, problems: [problem] });
  });

  it.each<[string, unknown]>([
    ['anchor on a trim', wirePlan({ do: 'trim', clip: 'c1', anchor: 'c2', keep: 'start', seconds: 2 })],
    ['clip on a music step', wirePlan({ do: 'sound', target: 'music', clip: 'c1', volume: 0.2 })],
    ['clip on an end caption', wirePlan({ do: 'caption_add', where: 'end', clip: 'c1', text: 'a' })],
    ['from on a clip caption', wirePlan({ do: 'caption_add', where: 'clip', clip: 'c1', from: 1, text: 'a' })],
    ['seconds on a range caption', wirePlan({ do: 'caption_add', where: 'range', from: 1, to: 3, seconds: 2, text: 'a' })],
    ['a caption edit without a change', wirePlan({ do: 'caption_edit', caption: 't2', secondsPerClip: 0 })],
    ['a bad anchor', wirePlan({ do: 'move', clip: 'c1', place: 'after', anchor: 't1' })],
    ['an unknown kind', wirePlan({ do: 'speed', clip: 'c1' })],
    ['a step that is not an object', wirePlan('trim c1' as unknown as Record<string, unknown>)],
    ['steps that are not a list', { kind: 'plan', steps: 'trim' }],
    ['no kind', { steps: [{ do: 'remove', clip: 'c1' }] }],
    ['a string', 'not json'],
    ['null', null],
    ['a list', [{ do: 'remove', clip: 'c1' }]],
  ])('refuses garbage without throwing: %s', (_label, raw) => {
    const parsed = parseModelReply(raw);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.problems.length).toBeGreaterThan(0);
  });

  it('drops nulls and [] a flat schema invites before rewriting', () => {
    expect(parseModelReply(wirePlan({ do: 'move', clip: 'c4', place: 'first', anchor: null, protect: [] }))).toEqual(
      parsedSteps({ do: 'move', clip: 'c4', to: 'first' }),
    );
    expect(
      parseModelReply({ kind: 'ask', about: 'which_clip', choices: ['c1', 'c2'], steps: [], reason: null }),
    ).toEqual({ ok: true, plan: { kind: 'ask', about: 'which_clip', choices: ['c1', 'c2'] } });
  });

  it('passes ask and cannot replies through untouched', () => {
    expect(editPlanFromWire({ kind: 'cannot', reason: 'not_timeline_edit' })).toEqual({
      ok: true,
      value: { kind: 'cannot', reason: 'not_timeline_edit' },
    });
    expect(parseModelReply({ kind: 'ask', about: 'how_long', choices: ['2', '3'] })).toEqual({
      ok: true,
      plan: { kind: 'ask', about: 'how_long', choices: ['2', '3'] },
    });
  });

  it('reads every canned answer of the instruction table in its wire form exactly as in its internal form', () => {
    for (const c of EDIT_ASSIST_CASES) {
      const internal = parseEditPlan(c.reply);
      expect(internal.ok, c.id).toBe(true);
      expect(parseModelReply(editPlanToWire(c.reply)), c.id).toEqual(internal);
      // A reply already in the internal shape is not rewritten either.
      expect(parseModelReply(c.reply), c.id).toEqual(internal);
    }
  });

  it('round-trips EditPlan → wire → EditPlan', () => {
    const plan: EditPlan = { kind: 'plan', steps: ONE_OF_EACH.slice(0, 12) };
    const wire = editPlanFromWire(editPlanToWire(plan));
    expect(wire).toEqual({ ok: true, value: plan });
  });
});
