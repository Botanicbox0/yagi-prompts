import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClosedAllowanceBanner } from '@/components/brand-studio/closed-allowance-banner';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { mountDom, type MountedDom } from '@/tests/brands/_dom-harness';
import { ORG } from './fixtures';

/**
 * The closed studio banner remembers that an access request was already sent: it asks the server once
 * on mount and flips after a successful request in its own dialog, so the customer does not send the
 * same request twice. Until it knows (or when it cannot tell) it is exactly today's banner.
 */
const dict = getDictionary('ko');
const dock = dict.brandStudio.dock;
const billing = dict.brandBilling.customer;
const ACCESS_URL = `/api/brand-workspace/access-request?organizationId=${encodeURIComponent(ORG)}`;

type FetchInit = RequestInit | undefined;
type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
const okJson = (body: unknown, status = 200): FakeResponse => ({ ok: status < 400, status, json: async () => body });

function stubFetch(
  access: (init: FetchInit) => Promise<FakeResponse>,
  billingRequest: (body: Record<string, unknown>) => Promise<FakeResponse> = async (body) =>
    okJson({ ok: true, id: 'r1', noticeKind: body.intent === 'allowance_request' ? 'allowance_request' : 'plan_request' }),
) {
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    if (href.startsWith('/api/brand-workspace/access-request')) return access(init);
    if (href === '/api/brand-billing/request') return billingRequest(JSON.parse(String(init?.body ?? '{}')));
    throw new Error(`unexpected fetch ${href}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const mounted: MountedDom[] = [];
async function mountBanner(props: Partial<Parameters<typeof ClosedAllowanceBanner>[0]> = {}) {
  const dom = await mountDom(
    <ClosedAllowanceBanner
      organizationId={ORG}
      organizationName="Atelier Monet"
      dockCopy={dock}
      billingCopy={billing}
      locale="ko"
      surface="studio_image"
      {...props}
    />,
  );
  mounted.push(dom);
  await settle();
  return dom;
}

function bannerState(dom: MountedDom) {
  const section = dom.query('[data-studio-allowance-closed]');
  const button = dom.query('[data-studio-closed-request]');
  return {
    requested: Boolean(section?.hasAttribute('data-studio-closed-requested')),
    title: dom.query('section h2')?.textContent ?? '',
    body: dom.query('section p')?.textContent ?? '',
    action: button?.textContent ?? '',
    variant: button?.getAttribute('data-variant') ?? '',
  };
}

const TODAY = { requested: false, title: dock.closedTitle, body: dock.closedBody, action: dock.closedAction, variant: 'solid' };

afterEach(async () => {
  while (mounted.length > 0) await mounted.pop()!.unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('closed studio banner after an access request (PR2)', () => {
  it('ships the three requested-state strings in both dictionaries', () => {
    for (const locale of ['ko', 'en'] as const) {
      const d = getDictionary(locale).brandStudio.dock;
      for (const key of ['closedRequestedTitle', 'closedRequestedBody', 'closedRequestedAction'] as const) {
        expect(d[key], `${locale}.${key}`).toBeTruthy();
      }
      expect(d.closedRequestedTitle).not.toBe(d.closedTitle);
      expect(d.closedRequestedAction).not.toBe(d.closedAction);
    }
  });

  it('renders today\'s banner on the server: title, body and the solid button, no requested marker', () => {
    for (const billingCopy of [undefined, billing]) {
      const html = renderToStaticMarkup(
        <ClosedAllowanceBanner organizationId={ORG} dockCopy={dock} billingCopy={billingCopy} surface="studio_image" />,
      );
      expect(html).toContain('data-studio-allowance-closed');
      expect(html).not.toContain('data-studio-closed-requested');
      expect(html).toContain(dock.closedTitle);
      expect(html).toContain(dock.closedBody);
      expect(html).toContain(dock.closedAction);
      expect(html).toContain('data-variant="solid"');
      expect(html).not.toContain(dock.closedRequestedTitle);
    }
  });

  it('asks the server once on mount (no-store, same-origin) and shows the requested state with a non-solid button that still opens the dialog', async () => {
    const fetchMock = stubFetch(async () => okJson({ ok: true, requested: true }));
    const dom = await mountBanner();

    const accessCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/brand-workspace/access-request'));
    expect(accessCalls).toHaveLength(1);
    expect(String(accessCalls[0]![0])).toBe(ACCESS_URL);
    const init = accessCalls[0]![1] as RequestInit;
    expect(init.cache).toBe('no-store');
    expect(init.credentials).toBe('same-origin');
    expect(init.method ?? 'GET').toBe('GET');
    expect(init.signal).toBeInstanceOf(AbortSignal);

    expect(bannerState(dom)).toEqual({
      requested: true,
      title: dock.closedRequestedTitle,
      body: dock.closedRequestedBody,
      action: dock.closedRequestedAction,
      variant: 'soft',
    });

    // The follow-up opens the same request dialog the checklist's follow-up opens, from this banner's surface.
    expect(dom.query('[role="dialog"]')).toBeNull();
    await dom.click('[data-studio-closed-request]');
    expect(dom.query('[role="dialog"]')).toBeTruthy();
    expect(dom.query('[data-billing-intent="plan_request"]')?.getAttribute('aria-checked')).toBe('true');
    await dom.submit('[data-billing-request-form]').then(settle);
    const posted = fetchMock.mock.calls.find(([url]) => String(url) === '/api/brand-billing/request');
    const payload = JSON.parse(String((posted![1] as RequestInit).body));
    expect(payload).toMatchObject({ organizationId: ORG, intent: 'plan_request', surface: 'studio_image' });
    expect(bannerState(dom).requested).toBe(true);
  });

  it('keeps today\'s banner when the answer is requested:false, a refusal, a malformed body or a network failure', async () => {
    const answers: Array<() => Promise<FakeResponse>> = [
      async () => okJson({ ok: true, requested: false }),
      async () => okJson({ ok: false }, 404),
      async () => okJson({ ok: true }),
      async () => okJson({ ok: true, requested: 'yes' }),
      async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } }),
      async () => { throw new TypeError('network down'); },
    ];
    for (const next of answers) {
      stubFetch(next);
      const dom = await mountBanner();
      expect(bannerState(dom)).toEqual(TODAY);
      await mounted.pop()!.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('flips to the requested state after a successful plan request or allowance request in its own dialog, without a reload', async () => {
    for (const intent of ['plan_request', 'allowance_request'] as const) {
      const fetchMock = stubFetch(async () => okJson({ ok: true, requested: false }));
      const dom = await mountBanner();
      expect(bannerState(dom)).toEqual(TODAY);

      await dom.click('[data-studio-closed-request]');
      if (intent !== 'plan_request') await dom.click(`[data-billing-intent="${intent}"]`);
      await dom.submit('[data-billing-request-form]').then(settle);
      expect(dom.query('[data-billing-request-submitted]')).toBeTruthy();
      expect(bannerState(dom)).toEqual({
        requested: true,
        title: dock.closedRequestedTitle,
        body: dock.closedRequestedBody,
        action: dock.closedRequestedAction,
        variant: 'soft',
      });
      // Only the one mount-time read: the flip comes from the dialog, not a second request.
      expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/brand-workspace/access-request'))).toHaveLength(1);
      await mounted.pop()!.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('stays unchanged after a plain plan question or a failed request', async () => {
    stubFetch(async () => okJson({ ok: true, requested: false }));
    const question = await mountBanner();
    await question.click('[data-studio-closed-request]');
    await question.click('[data-billing-intent="plan_question"]');
    await question.submit('[data-billing-request-form]').then(settle);
    expect(question.query('[data-billing-request-submitted]')).toBeTruthy();
    expect(bannerState(question)).toEqual(TODAY);
    await mounted.pop()!.unmount();
    vi.unstubAllGlobals();

    stubFetch(
      async () => okJson({ ok: true, requested: false }),
      async () => okJson({ ok: false, code: 'rate_limited' }, 429),
    );
    const failed = await mountBanner();
    await failed.click('[data-studio-closed-request]');
    await failed.submit('[data-billing-request-form]').then(settle);
    expect(failed.query('[data-billing-request-error]')).toBeTruthy();
    expect(bannerState(failed)).toEqual(TODAY);
  });

  it('makes no request when the dialog cannot open (no billing copy) or there is no organization', async () => {
    const fetchMock = stubFetch(async () => okJson({ ok: true, requested: true }));
    const noBilling = await mountBanner({ billingCopy: undefined });
    expect(bannerState(noBilling)).toEqual(TODAY);
    await mountBanner({ organizationId: '' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts the read when the banner unmounts before the answer arrives', async () => {
    const seen: { signal?: AbortSignal; release?: (value: FakeResponse) => void } = {};
    stubFetch(
      (init) =>
        new Promise<FakeResponse>((resolve) => {
          seen.signal = init?.signal ?? undefined;
          seen.release = resolve;
        }),
    );
    await mountBanner();
    expect(seen.signal?.aborted).toBe(false);
    await mounted.pop()!.unmount();
    expect(seen.signal?.aborted).toBe(true);
    // A late answer after unmount is dropped quietly.
    seen.release?.(okJson({ ok: true, requested: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('falls back to today\'s strings when a dictionary lacks the three new keys, keeping the requested marker and button style', async () => {
    const {
      closedRequestedTitle: _title,
      closedRequestedBody: _body,
      closedRequestedAction: _action,
      ...olderDock
    } = dock;
    stubFetch(async () => okJson({ ok: true, requested: true }));
    const dom = await mountBanner({ dockCopy: olderDock });
    expect(bannerState(dom)).toEqual({
      requested: true,
      title: dock.closedTitle,
      body: dock.closedBody,
      action: dock.closedAction,
      variant: 'soft',
    });
    await dom.click('[data-studio-closed-request]');
    expect(dom.query('[role="dialog"]')).toBeTruthy();
  });
});
