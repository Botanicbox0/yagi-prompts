import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SupportDrawer, supportSeenStorageKey } from '@/components/brand-workspace/support';
import { hasVisibleProject } from '@/lib/brands/workspace/selection';
import type { BrandMessage, BrandOrganization } from '@/lib/brands/workspace/types';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { mountDom, type MountedDom } from '@/tests/brands/_dom-harness';

/**
 * The floating support launcher shows its dot only for a team reply this browser has not shown yet
 * (one cheap read on mount; the "seen" mark lives in this browser per organization), and the quick
 * question chips only offer campaign questions to a brand that has a campaign.
 */
const b = getDictionary('ko').brandWorkspace;
const ORG_A = 'a1111111-1111-4111-8111-111111111111';
const ORG_B = 'b2222222-2222-4222-8222-222222222222';
const org = (id: string, name = 'Fixture brand'): BrandOrganization => ({ id, name, role: 'owner' });

type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
const okJson = (body: unknown, status = 200): FakeResponse => ({ ok: status < 400, status, json: async () => body });

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
  };
}

function stubFetch(
  peekAnswer: (organizationId: string) => Promise<FakeResponse>,
  thread: (organizationId: string) => BrandMessage[] = () => [],
) {
  const fetchMock = vi.fn(async (url: string | URL, _init?: RequestInit) => {
    const parsed = new URL(String(url), 'https://brand.twings.app');
    if (parsed.pathname !== '/api/brand-workspace') throw new Error(`unexpected fetch ${String(url)}`);
    const organizationId = parsed.searchParams.get('organizationId') ?? '';
    if (parsed.searchParams.get('peek') === '1') return peekAnswer(organizationId);
    return okJson({ ok: true, messages: thread(organizationId) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const peekCalls = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchMock.mock.calls.filter(([url]) => new URL(String(url), 'https://brand.twings.app').searchParams.get('peek') === '1');
const fullCalls = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchMock.mock.calls.filter(([url]) => new URL(String(url), 'https://brand.twings.app').searchParams.get('peek') !== '1');

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const mounted: MountedDom[] = [];
async function mountDrawer(organizations: BrandOrganization[], extra: { hasProjects?: boolean } = {}) {
  const dom = await mountDom(<SupportDrawer organizations={organizations} b={b} locale="ko" {...extra} />);
  mounted.push(dom);
  // The harness has no <dialog> methods; the drawer only needs them to exist.
  const dialog = dom.query('[data-support-dialog]') as unknown as { show?: () => void; close?: () => void } | null;
  if (dialog) {
    dialog.show = () => {};
    dialog.close = () => {};
  }
  await settle();
  return dom;
}

function launcher(dom: MountedDom) {
  const button = dom.query('[data-concierge-launcher]');
  return {
    dot: Boolean(dom.query('[data-concierge-launcher] [data-concierge-new]')),
    label: button?.getAttribute('aria-label') ?? null,
    count: Boolean(dom.query('[data-concierge-unread]')),
  };
}
const NO_DOT = { dot: false, label: b.managed.support, count: false };
const DOT = { dot: true, label: b.managed.supportNewReply, count: false };

let storage: ReturnType<typeof memoryStorage>;
beforeEach(() => {
  storage = memoryStorage();
  vi.stubGlobal('localStorage', storage);
});

afterEach(async () => {
  while (mounted.length > 0) await mounted.pop()!.unmount();
  vi.unstubAllGlobals();
});

describe('support launcher dot', () => {
  it('shows no dot when the team has not replied, and reads once on mount with no polling while closed', async () => {
    const fetchMock = stubFetch(async () => okJson({ ok: true, latestStudioReplyAt: null }));
    const dom = await mountDrawer([org(ORG_A)]);
    expect(launcher(dom)).toEqual(NO_DOT);

    expect(peekCalls(fetchMock)).toHaveLength(1);
    const [url, init] = peekCalls(fetchMock)[0]!;
    expect(String(url)).toBe(`/api/brand-workspace?organizationId=${ORG_A}&peek=1`);
    expect((init as RequestInit).cache).toBe('no-store');
    expect((init as RequestInit).credentials).toBe('same-origin');
    // The full read (which also picks up replies from outside) waits until the window opens.
    expect(fullCalls(fetchMock)).toHaveLength(0);

    await settle();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows the dot for a team reply when nothing is stored, or when it is newer than what this browser has seen', async () => {
    stubFetch(async () => okJson({ ok: true, latestStudioReplyAt: '2026-11-21T03:30:00.000Z' }));
    const never = await mountDrawer([org(ORG_A)]);
    expect(launcher(never)).toEqual(DOT);
    await mounted.pop()!.unmount();

    storage.setItem(supportSeenStorageKey(ORG_A), '2026-11-20T00:00:00.000Z');
    const older = await mountDrawer([org(ORG_A)]);
    expect(launcher(older)).toEqual(DOT);
    await mounted.pop()!.unmount();

    storage.setItem(supportSeenStorageKey(ORG_A), '2026-11-21T03:30:00.000Z');
    const seen = await mountDrawer([org(ORG_A)]);
    expect(launcher(seen)).toEqual(NO_DOT);
    await mounted.pop()!.unmount();

    storage.setItem(supportSeenStorageKey(ORG_A), 'not a time');
    const unreadable = await mountDrawer([org(ORG_A)]);
    expect(launcher(unreadable)).toEqual(DOT);
  });

  it('opening the window clears the dot and stores the newest team reply it showed', async () => {
    const thread: BrandMessage[] = [
      { id: 'm1', body: 'question', authorRole: 'brand', createdAt: '2026-11-20T01:00:00.000Z' },
      { id: 'm2', body: 'answer', authorRole: 'studio', createdAt: '2026-11-21T03:30:00.000Z' },
      { id: 'm3', body: 'thanks', authorRole: 'brand', createdAt: '2026-11-22T04:00:00.000Z' },
    ];
    const fetchMock = stubFetch(async () => okJson({ ok: true, latestStudioReplyAt: '2026-11-21T03:30:00.000Z' }), () => thread);
    const dom = await mountDrawer([org(ORG_A)]);
    expect(launcher(dom)).toEqual(DOT);

    await dom.click('[data-concierge-launcher]');
    await settle();
    expect(fullCalls(fetchMock)).toHaveLength(1);
    expect(Boolean(dom.query('[data-concierge-launcher] [data-concierge-new]'))).toBe(false);
    expect(storage.getItem(supportSeenStorageKey(ORG_A))).toBe('2026-11-21T03:30:00.000Z');

    // Closed again: nothing new.
    await dom.click('[data-concierge-launcher]');
    await settle();
    expect(launcher(dom)).toEqual(NO_DOT);
  });

  it('stores a team reply that only the opened thread brought in (newer than the mount-time read)', async () => {
    const thread: BrandMessage[] = [
      { id: 'm2', body: 'answer', authorRole: 'studio', createdAt: '2026-11-21T03:30:00.000Z' },
      { id: 'm4', body: 'another answer', authorRole: 'studio', createdAt: '2026-11-23T05:00:00.000Z' },
    ];
    stubFetch(async () => okJson({ ok: true, latestStudioReplyAt: '2026-11-21T03:30:00.000Z' }), () => thread);
    const dom = await mountDrawer([org(ORG_A)]);
    await dom.click('[data-concierge-launcher]');
    await settle();
    expect(storage.getItem(supportSeenStorageKey(ORG_A))).toBe('2026-11-23T05:00:00.000Z');
    await dom.click('[data-concierge-launcher]');
    await settle();
    expect(launcher(dom)).toEqual(NO_DOT);
  });

  it('does not carry one organization\'s state into another', async () => {
    const latest: Record<string, string | null> = { [ORG_A]: '2026-11-21T03:30:00.000Z', [ORG_B]: null };
    stubFetch(async (id) => okJson({ ok: true, latestStudioReplyAt: latest[id] ?? null }));

    // The workspace remounts the drawer per brand.
    const a = await mountDrawer([org(ORG_A)]);
    expect(launcher(a)).toEqual(DOT);
    await mounted.pop()!.unmount();
    const bDom = await mountDrawer([org(ORG_B)]);
    expect(launcher(bDom)).toEqual(NO_DOT);
    await mounted.pop()!.unmount();

    // A seen mark for one brand is not a seen mark for another.
    latest[ORG_B] = '2026-11-21T03:30:00.000Z';
    storage.setItem(supportSeenStorageKey(ORG_A), '2026-11-22T00:00:00.000Z');
    const bAgain = await mountDrawer([org(ORG_B)]);
    expect(launcher(bAgain)).toEqual(DOT);
    expect(storage.getItem(supportSeenStorageKey(ORG_B))).toBeNull();
    // (The drawer's own brand picker for several brands is not mounted here: the harness has no <select>.)
  });

  it('shows no dot when the read fails, is refused or answers something unexpected', async () => {
    const answers: Array<() => Promise<FakeResponse>> = [
      async () => okJson({ ok: false }, 404),
      async () => okJson({ ok: false }, 503),
      async () => okJson({ ok: true }),
      async () => okJson({ ok: true, latestStudioReplyAt: 42 }),
      async () => okJson({ ok: true, latestStudioReplyAt: 'yesterday' }),
      async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } }),
      async () => { throw new TypeError('network down'); },
    ];
    for (const next of answers) {
      stubFetch(next);
      const dom = await mountDrawer([org(ORG_A)]);
      expect(launcher(dom)).toEqual(NO_DOT);
      await mounted.pop()!.unmount();
    }
  });

  it('makes no read for a viewer with no organization', async () => {
    const fetchMock = stubFetch(async () => okJson({ ok: true, latestStudioReplyAt: '2026-11-21T03:30:00.000Z' }));
    const dom = await mountDrawer([]);
    expect(Boolean(dom.query('[data-concierge-launcher]'))).toBe(false);
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('quick question chips', () => {
  const chipLabels = (html: string) => [...html.matchAll(/<button[^>]*class="bw-concierge-chip"[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);
  const topics = b.managed.concierge.topics;

  it('offers only the quote chip to a brand with no campaign yet', () => {
    for (const hasProjects of [false, undefined]) {
      const html = renderToStaticMarkup(
        <SupportDrawer organizations={[org(ORG_A)]} b={b} locale="ko" {...(hasProjects === undefined ? {} : { hasProjects })} />,
      );
      expect(chipLabels(html)).toEqual([topics.quoteLabel]);
    }
  });

  it('offers all four campaign chips, in today\'s order, once the brand has a campaign', () => {
    const html = renderToStaticMarkup(<SupportDrawer organizations={[org(ORG_A)]} b={b} locale="ko" hasProjects />);
    expect(chipLabels(html)).toEqual([topics.timelineLabel, topics.creatorsLabel, topics.quoteLabel, topics.feedbackLabel]);
  });

  it('reads "has a campaign" from the workspace scope the layout already loaded', () => {
    const scope = {
      choices: [],
      projectOrganizations: { 'c0000000-0000-4000-8000-000000000001': ORG_B },
    };
    expect(hasVisibleProject(scope, ORG_B)).toBe(true);
    expect(hasVisibleProject(scope, ORG_A)).toBe(false);
    expect(hasVisibleProject({ choices: [], projectOrganizations: {} }, ORG_A)).toBe(false);
  });
});
