import { describe, expect, it } from 'vitest';
import { applyEditSteps, resolveAskChoices, resolveEditPlan } from '@/lib/brand-studio/edit-assist/apply';
import { buildEditContext } from '@/lib/brand-studio/edit-assist/context';
import { diffTimelines, isInstantEdit, type EditDelta } from '@/lib/brand-studio/edit-assist/diff';
import { EDIT_STEP_KINDS, parseEditPlan } from '@/lib/brand-studio/edit-assist/plan';
import { EDIT_ASSIST_CASES, editAssistCaseTimeline, type EditAssistCase } from './cases';

/** Every canned model answer in the instruction table, through validate → resolve → apply → diff. */
describe('edit-assist instruction table', () => {
  it('holds 60 instructions, 45 Korean and 15 English, with unique ids', () => {
    expect(EDIT_ASSIST_CASES).toHaveLength(60);
    expect(EDIT_ASSIST_CASES.filter((c) => c.locale === 'ko')).toHaveLength(45);
    expect(EDIT_ASSIST_CASES.filter((c) => c.locale === 'en')).toHaveLength(15);
    expect(new Set(EDIT_ASSIST_CASES.map((c) => c.id)).size).toBe(60);
  });

  it('uses every step kind and every named delta kind at least once', () => {
    const steps = new Set(
      EDIT_ASSIST_CASES.flatMap((c) => (c.reply.kind === 'plan' ? c.reply.steps.map((s) => s.do) : [])),
    );
    expect([...steps].sort()).toEqual([...EDIT_STEP_KINDS].sort());
    const deltas = new Set(EDIT_ASSIST_CASES.flatMap((c) => (c.expect.kind === 'plan' ? c.expect.deltas.map((d) => d.kind) : [])));
    const named: Array<EditDelta['kind']> = [
      'clip_removed',
      'clip_split',
      'clip_trimmed',
      'clip_moved',
      'clip_sound',
      'caption_removed',
      'caption_changed',
      'caption_added',
      'music_removed',
      'music_volume',
      'aspect',
      'look',
      'total',
    ];
    for (const kind of named) expect(deltas, kind).toContain(kind);
  });

  it.each(EDIT_ASSIST_CASES.map((c) => [c.id, c] as [string, EditAssistCase]))('%s', (_id, c) => {
    const timeline = editAssistCaseTimeline();
    const parsed = parseEditPlan(c.reply);
    expect(parsed.ok, c.instruction).toBe(true);
    if (!parsed.ok) return;

    const { context, refs } = buildEditContext(timeline, c.context ?? {});
    if (c.expectContext) expect(context).toMatchObject(c.expectContext);

    const plan = parsed.plan;
    switch (c.expect.kind) {
      case 'plan':
      case 'problems': {
        expect(plan.kind).toBe('plan');
        if (plan.kind !== 'plan') return;
        const resolved = resolveEditPlan(plan.steps, refs);
        expect(resolved.ok).toBe(true);
        if (!resolved.ok) return;
        const applied = applyEditSteps(timeline, resolved.steps);
        if (c.expect.kind === 'problems') {
          expect(applied.problems).toEqual(c.expect.problems);
          expect(applied.project).toBe(timeline);
          return;
        }
        expect(applied.problems).toEqual([]);
        const deltas = diffTimelines(timeline, applied.project);
        expect(deltas).toEqual(c.expect.deltas);
        expect(isInstantEdit(deltas)).toBe(c.expect.instant);
        return;
      }
      case 'ask':
        expect(plan).toMatchObject({ kind: 'ask', about: c.expect.about });
        if (plan.kind !== 'ask') return;
        expect(resolveAskChoices(plan.about, plan.choices, refs)).toEqual(c.expect.choices);
        return;
      case 'cannot':
        expect(plan).toEqual({ kind: 'cannot', reason: c.expect.reason });
        return;
    }
  });
});
