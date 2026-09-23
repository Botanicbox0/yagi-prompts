import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

/**
 * Client behaviour of the workspace forms without a DOM: hooks are replaced by a tiny recorder so
 * effects run when the test says the commit happened, and state setters can be inspected.
 */
const hooks = vi.hoisted(() => ({
  effects: [] as Array<() => void>,
  setters: [] as Array<ReturnType<typeof vi.fn>>,
  initial: new Map<number, unknown>(),
  calls: 0,
}));
const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));
// The boundary's copy comes from the layout's context; this test calls the component outside a render.
vi.mock('@/components/brand-workspace/error-copy', () => ({ useBrandErrorCopy: () => ({ title: 'Fixture title', retry: 'Fixture retry' }) }));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useEffect: (effect: () => void) => { hooks.effects.push(effect); },
  useState: (value: unknown) => {
    const index = hooks.calls++;
    const set = vi.fn();
    hooks.setters.push(set);
    return [hooks.initial.has(index) ? hooks.initial.get(index) : value, set];
  },
  useRef: (value: unknown) => ({ current: value }),
  useId: () => 'fixture-id',
}));

import { ActionForm } from '@/components/brand-workspace/action-form';
import { ManagedForm, managedErrorMessage } from '@/components/brand-workspace/managed-form';
import { ConfirmStep, isConfirmedSubmit, useConfirmStep } from '@/components/brand-workspace/confirm-step';
import { createFieldFocus, fieldForPath, locateField, revealField } from '@/components/brand-workspace/form-errors';
import BrandError from '@/app/(brand)/brand/error';
import { getDictionary } from '@/lib/i18n/dictionaries';

const b = getDictionary('ko').brandWorkspace;
const runEffects = () => { for (const effect of hooks.effects.splice(0)) effect(); };

/** Just enough DOM: tag, parent chain, `disabled`, `open`, focus that records whether it could land. */
function node(tagName: string, parentElement: FakeNode | null = null, extra: Partial<FakeNode> = {}): FakeNode {
  const n: FakeNode = {
    tagName, parentElement, disabled: false, open: false, attributes: {}, focusedWhileBlocked: [],
    focus: vi.fn<() => void>(() => {
      let blocked = false;
      for (let p: FakeNode | null = n; p; p = p.parentElement) if (p.disabled && (p === n || p.tagName === 'FIELDSET')) blocked = true;
      n.focusedWhileBlocked.push(blocked);
    }),
    setAttribute(name: string, value: string) { n.attributes[name] = value; },
    ...extra,
  };
  return n;
}
interface FakeNode {
  tagName: string; parentElement: FakeNode | null; disabled: boolean; open: boolean;
  attributes: Record<string, string>; focusedWhileBlocked: boolean[];
  focus: ReturnType<typeof vi.fn<() => void>>; setAttribute(name: string, value: string): void;
}
function fakeForm(fields: Record<string, FakeNode[]>) {
  return { querySelectorAll: (selector: string) => fields[/^\[name="(\w+)"\]$/.exec(selector)?.[1] ?? ''] ?? [] };
}

beforeEach(() => {
  hooks.effects.length = 0; hooks.setters.length = 0; hooks.initial.clear(); hooks.calls = 0;
  const NativeFormData = FormData;
  // The fake forms are not HTMLFormElements; the posted values are not what these tests check.
  vi.stubGlobal('FormData', class extends NativeFormData { constructor() { super(); } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('nested validation paths', () => {
  it('maps server paths to the flat inputs the forms post', () => {
    expect(fieldForPath('criteria.maxFollowers')).toEqual({ name: 'maxFollowers', index: 0 });
    expect(fieldForPath('referenceLinks.1.url')).toEqual({ name: 'referenceUrl', index: 1 });
    expect(fieldForPath('referenceLinks.2.note')).toEqual({ name: 'referenceNote', index: 2 });
    expect(fieldForPath('comment')).toEqual({ name: 'comment', index: 0 });
    expect(fieldForPath('')).toBeNull();
    expect(fieldForPath('x"] , [name="y')).toBeNull();
  });

  it('marks the reference row the server named, not the first one', () => {
    const urls = [node('INPUT'), node('INPUT'), node('INPUT')];
    expect(locateField(fakeForm({ referenceUrl: urls }), 'referenceLinks.1.url')).toBe(urls[1]);
  });

  it('opens every collapsed section around the invalid field', () => {
    const outer = node('DETAILS'), inner = node('DETAILS', node('DIV', outer));
    const field = node('INPUT', node('LABEL', inner));
    revealField(field);
    expect(outer.open).toBe(true);
    expect(inner.open).toBe(true);
  });
});

describe('focus timing', () => {
  it('waits for the disabled fieldset to re-enable, then focuses exactly once', () => {
    const fieldset = node('FIELDSET', null, { disabled: true });
    const field = node('INPUT', node('LABEL', fieldset));
    const focus = createFieldFocus();
    focus.request(field);
    expect(focus.flush()).toBe(false);
    expect(field.focus).not.toHaveBeenCalled();
    fieldset.disabled = false;
    expect(focus.flush()).toBe(true);
    expect(focus.flush()).toBe(false);
    expect(field.focusedWhileBlocked).toEqual([false]);
  });

  it('never tries to focus while the request holds the form disabled; focuses after the commit', async () => {
    // The brief form: follower bounds live in a collapsed <details> inside the disabled fieldset.
    const fieldset = node('FIELDSET', null, { disabled: true });
    const details = node('DETAILS', fieldset);
    const max = node('INPUT', node('LABEL', details));
    const form = fakeForm({ maxFollowers: [max] });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ ok: false, code: 'invalid', field: 'criteria.maxFollowers' }) }));
    const element = ActionForm({ operation: 'project.create', b, submit: 'Send' }) as ReactElement<{ onSubmit(e: unknown): Promise<void> }>;
    await element.props.onSubmit({ preventDefault: vi.fn(), currentTarget: form });
    expect(max.attributes['aria-invalid']).toBe('true');
    expect(details.open).toBe(true);
    expect(max.focus).not.toHaveBeenCalled();
    // React commits busy=false, the fieldset re-enables, then effects run.
    fieldset.disabled = false;
    runEffects();
    expect(max.focus).toHaveBeenCalledOnce();
    expect(max.focusedWhileBlocked).toEqual([false]);
  });

  it('maps a submitted reference index back past the blank rows the form dropped', async () => {
    // Row 0 blank, row 1 "http://" (valid for the browser, refused by the HTTPS rule), row 2 blank.
    const posted: Array<[string, string]> = [
      ['referenceUrl', ''], ['referenceNote', ''],
      ['referenceUrl', 'http://example.com'], ['referenceNote', 'moodboard'],
      ['referenceUrl', '  '], ['referenceNote', ''],
    ];
    const NativeFormData = FormData;
    vi.stubGlobal('FormData', class extends NativeFormData { constructor() { super(); for (const [k, v] of posted) this.append(k, v); } });
    const fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ ok: false, code: 'invalid', field: 'referenceLinks.0.url' }) });
    vi.stubGlobal('fetch', fetch);
    const urls = [node('INPUT'), node('INPUT'), node('INPUT')];
    const element = ActionForm({ operation: 'project.create', b, submit: 'Send' }) as ReactElement<{ onSubmit(e: unknown): Promise<void> }>;
    await element.props.onSubmit({ preventDefault: vi.fn(), currentTarget: fakeForm({ referenceUrl: urls }) });
    // The empty-row filtering itself is unchanged: only the non-empty row was posted.
    expect(JSON.parse(fetch.mock.calls[0]![1].body).input.referenceLinks).toEqual([{ url: 'http://example.com', note: 'moodboard' }]);
    expect(urls.map((u) => u.attributes['aria-invalid'])).toEqual([undefined, 'true', undefined]);
  });

  it('marks the note of the right row and marks nothing for an index it cannot place', () => {
    const notes = [node('INPUT'), node('INPUT'), node('INPUT')];
    const form = fakeForm({ referenceNote: notes });
    // Rows 1 and 2 were submitted as indexes 0 and 1.
    expect(locateField(form, 'referenceLinks.1.note', { referenceLinks: [1, 2] })).toBe(notes[2]);
    expect(locateField(form, 'referenceLinks.5.url', { referenceLinks: [1, 2] })).toBeNull();
  });

  it('shows the rate-limit message instead of blaming the connection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ ok: false, code: 'rate_limited' }) }));
    const element = ActionForm({ operation: 'message.send', b, submit: 'Send' }) as ReactElement<{ onSubmit(e: unknown): Promise<void> }>;
    await element.props.onSubmit({ preventDefault: vi.fn(), currentTarget: fakeForm({}) });
    expect(hooks.setters.some((set) => set.mock.calls.some(([v]) => v === b.errors.rateLimited))).toBe(true);
  });
});

describe('two-step confirmation', () => {
  const confirm = { prompt: b.confirm.shareContract, action: b.confirm.shareContractAction };
  const confirmed = { preventDefault: vi.fn(), currentTarget: undefined, nativeEvent: { submitter: { dataset: { confirmStep: 'confirm' } } } };

  it('treats only the confirmation button as consent', () => {
    expect(isConfirmedSubmit({ nativeEvent: { submitter: { dataset: {} } } })).toBe(false);
    expect(isConfirmedSubmit({ nativeEvent: { submitter: null } })).toBe(false);
    expect(isConfirmedSubmit({})).toBe(false);
    expect(isConfirmedSubmit(confirmed)).toBe(true);
  });

  it('opens the confirmation on the first submit and sends nothing', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const element = ManagedForm({ op: 'brandWorkspace.contractShare', b, submit: b.managed.share, children: null, confirm }) as ReactElement<{ onSubmit(e: unknown): Promise<void> }>;
    const open = hooks.setters[0]!; // useConfirmStep's state is the first hook in the form
    await element.props.onSubmit({ preventDefault: vi.fn(), currentTarget: undefined, nativeEvent: { submitter: { dataset: {} } } });
    expect(fetch).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(true);
  });

  it('sends once when confirmed, even if the confirm button is pressed twice', async () => {
    let finish: (value: unknown) => void = () => {};
    const fetch = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('location', { pathname: '/admin/brand-workspace/project', assign: vi.fn() });
    const element = ManagedForm({ op: 'brandWorkspace.contractShare', b, submit: b.managed.share, children: null, confirm }) as ReactElement<{ onSubmit(e: unknown): Promise<void> }>;
    const first = element.props.onSubmit(confirmed);
    await element.props.onSubmit(confirmed);
    finish({ ok: true, json: async () => ({ ok: true, to: '/admin/brand-workspace/project' }) });
    await first;
    expect(fetch).toHaveBeenCalledOnce();
    expect(nav.refresh).toHaveBeenCalledOnce();
  });

  it('cancel sends nothing and returns focus to the original button', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const step = useConfirmStep(true);
    const trigger = { focus: vi.fn() };
    (step.trigger as { current: unknown }).current = trigger;
    step.close();
    runEffects(); // the commit after `open` becomes false
    expect(trigger.focus).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('renders a labelled group whose cancel is a plain button and Escape cancels', () => {
    const onCancel = vi.fn();
    const group = ConfirmStep({ id: 'c', copy: confirm, cancel: b.confirm.cancel, busy: false, working: b.working, tone: 'danger', accept: { current: null }, onCancel }) as ReactElement<{
      role: string; 'aria-labelledby': string; onKeyDown(e: unknown): void; children: ReactElement[];
    }>;
    expect(group.props.role).toBe('group');
    expect(group.props['aria-labelledby']).toBe('c');
    const actions = group.props.children[1] as ReactElement<{ children: ReactElement<{ type: string; onClick?: () => void; 'data-confirm-step'?: string }>[] }>;
    const [accept, cancel] = actions.props.children;
    expect(accept!.props.type).toBe('submit');
    expect(accept!.props['data-confirm-step']).toBe('confirm');
    expect(cancel!.props.type).toBe('button');
    cancel!.props.onClick!();
    group.props.onKeyDown({ key: 'Escape', preventDefault: vi.fn() });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});

describe('admin error messages', () => {
  it('names the actual refusal instead of the connection', () => {
    expect(managedErrorMessage(b, 'staleReview')).toBe(b.conflict);
    expect(managedErrorMessage(b, 'invalid')).toBe(b.errors.adminInvalid);
    expect(managedErrorMessage(b, 'forbidden')).toBe(b.errors.adminDenied);
    expect(managedErrorMessage(b, 'notFound')).toBe(b.errors.adminDenied);
    expect(managedErrorMessage(b, null)).toBe(b.error);
  });

  it('reports a stale revision from /admin/do as a conflict', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ ok: false, code: 'staleReview' }) }));
    const element = ManagedForm({ op: 'brandWorkspace.visibility', b, submit: 'Save', children: null }) as ReactElement<{ onSubmit(e: unknown): Promise<void> }>;
    await element.props.onSubmit({ preventDefault: vi.fn(), currentTarget: undefined });
    expect(hooks.setters.some((set) => set.mock.calls.some(([v]) => v === b.conflict))).toBe(true);
    expect(hooks.setters.some((set) => set.mock.calls.some(([v]) => v === b.error))).toBe(false);
  });
});

describe('brand error boundary', () => {
  it('asks the server for a fresh render before resetting the boundary', () => {
    const reset = vi.fn();
    const section = BrandError({ error: new Error('x'), reset }) as ReactElement<{ children: ReactElement<{ onClick(): void }>[] }>;
    section.props.children[1]!.props.onClick();
    expect(nav.refresh).toHaveBeenCalledOnce();
    expect(reset).toHaveBeenCalledOnce();
  });
});
