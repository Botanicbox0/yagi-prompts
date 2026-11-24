import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SoundStudio, type SoundStudioProps } from '@/components/brand-studio/sound/sound-studio';
import type { StudioAllowanceView } from '@/lib/brand-studio/contracts';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { mountDom, type MountedDom } from '@/tests/brands/_dom-harness';
import { ORG, allowance } from '@/tests/brand-studio/ui/fixtures';

/**
 * A closed sound studio (no allowance, or the server answered `allowance_closed`) shows the closed notice
 * with its request button, and its make button reads as unavailable: disabled, and neither a click, a
 * form submit nor Ctrl/Cmd+Enter sends a run. Open and exhausted studios are unchanged.
 */
const dict = getDictionary('ko');

function props(initialAllowance: StudioAllowanceView): SoundStudioProps {
  return {
    organizationId: ORG,
    organizationName: 'Fixture brand',
    locale: 'ko',
    copy: dict.studioSound,
    creditsCopy: dict.brandStudio.credits,
    billingCopy: dict.brandBilling.customer,
    initialTab: 'music',
    initialTracks: [],
    initialJobs: [],
    initialAllowance,
    maxMode: false,
    canCreate: true,
    audioMaxMb: 20,
    hrefs: {
      page: `/brand/studio/sound?organizationId=${ORG}`,
      compose: `/brand/studio/compose?organizationId=${ORG}`,
      video: `/brand/studio/video?organizationId=${ORG}`,
    },
  };
}

type Answer = { ok: boolean; status: number; json: () => Promise<unknown> };
const okJson = (body: unknown, status = 200): Answer => ({ ok: status < 400, status, json: async () => body });

function stubFetch(jobCreate: () => Answer) {
  const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { operation?: string };
    if (body.operation === 'job.create') return jobCreate();
    return okJson({ ok: false, code: 'failed' }, 400);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
const runs = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchMock.mock.calls.filter(([, init]) => (JSON.parse(String(init?.body ?? '{}')) as { operation?: string }).operation === 'job.create');

/** Ctrl/Cmd+Enter on the description (the harness's own key helper carries no modifier keys). */
async function commandEnter(dom: MountedDom, modifier: 'ctrlKey' | 'metaKey') {
  const field = dom.query('[data-sound-prompt]')!;
  const event = {
    type: 'keydown',
    bubbles: true,
    cancelable: true,
    defaultPrevented: false,
    cancelBubble: false,
    target: null,
    currentTarget: null,
    key: 'Enter',
    shiftKey: false,
    ctrlKey: modifier === 'ctrlKey',
    metaKey: modifier === 'metaKey',
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.cancelBubble = true;
    },
    stopImmediatePropagation() {
      this.cancelBubble = true;
    },
  };
  await act(async () => {
    field.dispatchEvent(event as never);
  });
  await settle();
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const mounted: MountedDom[] = [];
async function mount(initialAllowance: StudioAllowanceView) {
  const dom = await mountDom(<SoundStudio {...props(initialAllowance)} />);
  mounted.push(dom);
  return dom;
}

const makeDisabled = (dom: MountedDom) => dom.query('[data-sound-create]')!.hasAttribute('disabled');

/** A press of the make button as a browser handles it: a disabled submit button does nothing, else its form submits. */
async function pressMake(dom: MountedDom) {
  await dom.click('[data-sound-create]');
  if (!makeDisabled(dom)) await dom.submit('[data-sound-composer]');
  await settle();
}

afterEach(async () => {
  while (mounted.length > 0) await mounted.pop()!.unmount();
  vi.unstubAllGlobals();
});

describe('closed sound studio make button', () => {
  it('sends no run on click, form submit, Ctrl+Enter or Cmd+Enter while the allowance is closed', async () => {
    const fetchMock = stubFetch(() => okJson({ ok: false, code: 'allowance_closed' }, 409));
    const dom = await mount(allowance({ capKrw: 0, usedKrw: 0 }));
    await dom.setValue('[data-sound-prompt]', '미니멀 피아노 런웨이 테마');
    expect(makeDisabled(dom)).toBe(true);

    await pressMake(dom);
    // Implicit submission (Enter in a field of the form) is guarded too, not only the button.
    await dom.submit('[data-sound-composer]');
    await commandEnter(dom, 'ctrlKey');
    await commandEnter(dom, 'metaKey');
    expect(runs(fetchMock)).toHaveLength(0);
    expect(dom.query('[data-studio-allowance-notice="closed"]')).toBeTruthy();
  });

  it('closes after the server answers allowance_closed, so the next press sends nothing', async () => {
    const fetchMock = stubFetch(() => okJson({ ok: false, code: 'allowance_closed' }, 409));
    const dom = await mount(allowance({ capKrw: 50_000, usedKrw: 10_000 }));
    await dom.setValue('[data-sound-prompt]', '미니멀 피아노 런웨이 테마');
    expect(makeDisabled(dom)).toBe(false);

    await pressMake(dom);
    expect(runs(fetchMock)).toHaveLength(1);
    expect(dom.query('[data-studio-allowance-notice="closed"]')).toBeTruthy();
    expect(makeDisabled(dom)).toBe(true);

    await dom.submit('[data-sound-composer]');
    await commandEnter(dom, 'ctrlKey');
    expect(runs(fetchMock)).toHaveLength(1);
  });

  it('is unchanged when the allowance is open: Ctrl+Enter and the button send the run', async () => {
    const fetchMock = stubFetch(() => okJson({ ok: false, code: 'failed' }, 400));
    const dom = await mount(allowance({ capKrw: 50_000, usedKrw: 10_000 }));
    expect(makeDisabled(dom)).toBe(true); // nothing written yet: today's rule
    await dom.setValue('[data-sound-prompt]', '미니멀 피아노 런웨이 테마');
    expect(makeDisabled(dom)).toBe(false);

    await commandEnter(dom, 'ctrlKey');
    expect(runs(fetchMock)).toHaveLength(1);
    await pressMake(dom);
    expect(runs(fetchMock)).toHaveLength(2);
  });

  it('is unchanged when the allowance is used up: the press still goes to the server', async () => {
    const fetchMock = stubFetch(() => okJson({ ok: false, code: 'allowance_exhausted' }, 409));
    const dom = await mount(allowance({ capKrw: 50_000, usedKrw: 50_000 }));
    expect(dom.query('[data-studio-allowance-notice="exhausted"]')).toBeTruthy();
    await dom.setValue('[data-sound-prompt]', '미니멀 피아노 런웨이 테마');
    expect(makeDisabled(dom)).toBe(false);
    await pressMake(dom);
    expect(runs(fetchMock)).toHaveLength(1);
  });
});
