import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import type { SelfieView } from '@/lib/identity/selfie-service';
import { TwingsStudio, type StudioLabels, type StudioLive, type StudioStyle } from '@/components/twings/studio';
import { mountDom, type MountedDom } from '@/tests/brands/_dom-harness';

/**
 * The make card when the saved photo's file is gone from the render store (two were lost in the
 * 2026-11-12 move to R2). The access call still names the photo — it never asks storage — so the
 * card finds out when the photo's image fails to load, or when the order answers
 * `selfie_file_missing`. Either way: back to the photo step with one line saying the saved photo
 * could not be opened, an uploader that replaces it, and no order ever sent with that photo.
 */
const dict = getDictionary('ko');
const errors = dict.renders.studio.errors;
const labels: StudioLabels = {
  stepPhoto: dict.studio.stepPhoto, stepStyle: dict.studio.stepStyle, stepPay: dict.studio.stepPay, stepResult: dict.studio.stepResult,
  dropZone: dict.studio.dropZone, dropHint: dict.studio.dropHint, changePhoto: dict.studio.changePhoto, chooseStyle: dict.studio.chooseStyle,
  payCta: dict.studio.payCta, payNote: dict.studio.payNote, closedTitle: dict.studio.closedTitle, closedBody: dict.studio.closedBody,
  closedCta: dict.studio.closedCta, closedDone: dict.studio.closedDone, runtimeLabel: dict.studio.runtimeLabel, needPhoto: dict.studio.needPhoto,
  noStyles: dict.studio.noStyles, moreTemplates: dict.studio.moreTemplates, aspectLabel: dict.studio.aspectLabel, pending: dict.studio.pending,
};
const live: StudioLive = {
  endpoint: '/api/renders', accessEndpoint: '/api/renders/access', interestEndpoint: '/api/notify/interest',
  template: 'seoul-90s', locale: 'ko', signinHref: '/auth/signin', identityHref: '/identity/verify', selfie: dict.selfie,
  labels: {
    badge: dict.renders.studio.badge, operatorBadge: dict.renders.studio.operatorBadge, freeCta: dict.renders.studio.freeCta,
    submitting: dict.renders.studio.submitting, identityNotice: dict.renders.studio.identityNotice, identityPending: dict.renders.studio.identityPending,
    identityCta: dict.renders.studio.identityCta, errors,
  },
};
const style: StudioStyle = {
  id: 'seoul-90s', title: '90s Seoul Interview', price: '₩6,900', runtime: '15', blurb: '', posterSrc: '/p.jpg', videoSrc: null,
  moreHref: '/ko/video', aspects: [{ id: '9:16', label: '9:16' }], defaultAspect: '9:16',
};
const SELFIE: SelfieView = {
  id: '10000000-0000-4000-8000-000000000001', width: 320, height: 400, createdAt: '2026-11-01T00:00:00.000Z',
  imageUrl: '/api/identity/selfie/10000000-0000-4000-8000-000000000001/image', label: null, isDefault: true, lastUsedAt: null,
};

type Reply = { ok: boolean; status: number; json: () => Promise<unknown> };
const reply = (body: unknown, status = 200): Reply => ({ ok: status < 400, status, json: async () => body });
let orderReply: Reply;
let fetchMock: ReturnType<typeof vi.fn>;
let dom: MountedDom | null = null;

const orders = () => fetchMock.mock.calls.filter(([url]) => String(url) === '/api/billing/toss/orders');
/** Let the access call and its state settle. */
const settle = async () => { for (let i = 0; i < 3; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };
/** The browser's `error` event on an <img> (it does not bubble). */
async function imageFails(img: NonNullable<ReturnType<MountedDom['query']>>) {
  await act(async () => {
    img.dispatchEvent({ type: 'error', bubbles: false, cancelable: false, defaultPrevented: false, cancelBubble: false, target: null, currentTarget: null, preventDefault() {}, stopPropagation() {} } as never);
  });
}
const payButton = () => dom!.query('[data-pay-cta]')!;

beforeEach(async () => {
  orderReply = reply({ ok: false, code: 'selfie_file_missing' }, 409);
  fetchMock = vi.fn(async (url: string | URL) => {
    const path = String(url);
    if (path.startsWith('/api/renders/access')) return reply({ open: true, live: true, charge: true, signedIn: true, selfie: SELFIE });
    if (path === '/api/billing/toss/orders') return orderReply;
    return reply({ ok: false }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { fn(0); return 0; });
  dom = await mountDom(<TwingsStudio styles={[style]} labels={labels} initialStyleId="seoul-90s" live={live} initialAccess={{ open: true, live: true, signedIn: true }} />);
  await settle();
});
afterEach(async () => {
  await dom?.unmount();
  dom = null;
  vi.unstubAllGlobals();
});

describe('the make card when the saved photo cannot be opened', () => {
  it('starts on the saved photo as before', () => {
    expect(dom!.query('[data-selfie-sheet] img')?.getAttribute('src')).toBe(SELFIE.imageUrl);
    expect(Boolean(dom!.query('[data-selfie-missing]'))).toBe(false);
  });

  it('a failed image: one line saying so, an uploader that replaces it, and the pay button stays shut', async () => {
    await imageFails(dom!.query('[data-selfie-sheet] img')!);
    expect(dom!.query('[data-selfie-missing]')?.textContent).toBe(errors.selfie_file_missing);
    expect(Boolean(dom!.query('[data-selfie-sheet]'))).toBe(false);
    expect(Boolean(dom!.query('[data-selfie-panel] [data-selfie-uploader]'))).toBe(true);
    expect(payButton().hasAttribute('disabled')).toBe(true);
    await dom!.click(payButton());
    expect(orders()).toHaveLength(0);
  });

  it('a photo confirmed first and then failing: the choice is dropped, so no order can carry it', async () => {
    await dom!.click('[data-selfie-use]');
    expect(payButton().hasAttribute('disabled')).toBe(false);
    await imageFails(dom!.query('[data-selfie-sheet] img')!);
    expect(dom!.query('[data-selfie-missing]')?.textContent).toBe(errors.selfie_file_missing);
    expect(payButton().hasAttribute('disabled')).toBe(true);
    await dom!.click(payButton());
    expect(orders()).toHaveLength(0);
  });

  it('the order answering selfie_file_missing: the same line instead of the generic retry, and the photo is not offered again', async () => {
    await dom!.click('[data-selfie-use]');
    await dom!.click(payButton());
    await settle();
    expect(orders()).toHaveLength(1);
    expect((orders()[0]![1] as RequestInit).body instanceof FormData && ((orders()[0]![1] as RequestInit).body as FormData).get('selfieId')).toBe(SELFIE.id);
    expect(dom!.query('[data-selfie-missing]')?.textContent).toBe(errors.selfie_file_missing);
    expect(dom!.container.textContent).not.toContain(errors.generic);
    expect(Boolean(dom!.query('[data-selfie-sheet]'))).toBe(false);
    expect(payButton().hasAttribute('disabled')).toBe(true);
    await dom!.click(payButton());
    expect(orders()).toHaveLength(1);
  });
});
