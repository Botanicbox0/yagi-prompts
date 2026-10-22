import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CreatorAccountView, type CreatorAccountLabels } from '@/components/nav/creator-account';
import { observeCreatorSession, parseCreatorSession, type CreatorSession } from '@/lib/auth/observe-creator-session';

const labels: CreatorAccountLabels = { signIn: '로그인', profile: '내 프로필', selfie: '내 사진', renders: '내 작품', campaigns: '내 캠페인', signOut: '로그아웃', menu: '계정 메뉴', fallbackName: '크리에이터' };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function fixture() {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  let now = 0;
  const requests: Array<{ signal: AbortSignal; resolve: (value: { ok: boolean; json(): Promise<unknown> }) => void }> = [];
  const seen: CreatorSession[] = [];
  const dispose = observeCreatorSession({ window, document, now: () => now, fetch: signal => new Promise(resolve => { requests.push({ signal, resolve }); }) }, value => seen.push(value));
  return { window, document, requests, seen, dispose, advance: () => { now += 2_000; }, answer: (i: number, value: unknown) => requests[i]!.resolve({ ok: true, json: async () => value }) };
}

describe('creator account navigation', () => {
  it('shows the signed-in name and private destinations, including a POST sign out', () => {
    const html = renderToStaticMarkup(<CreatorAccountView session={{ signedIn: true, displayName: 'Creator A' }} labels={labels} signInHref="/auth/signin" />);
    expect(html).toContain('data-creator-account');
    expect(html).toContain('Creator A');
    for (const href of ['/account', '/renders', '/campaigns/mine']) expect(html).toContain(`href="${href}"`);
    expect(html).toMatch(/<form[^>]*action="\/auth\/signout"[^>]*method="post"/);
    expect(html).not.toContain('data-creator-signin');
  });
  it('keeps the login return path for anonymous readers', () => {
    const html = renderToStaticMarkup(<CreatorAccountView session={{ signedIn: false }} labels={labels} signInHref="/auth/signin?next=%2Fko%2Ft%2Fchosen" />);
    expect(html).toContain('next=%2Fko%2Ft%2Fchosen');
    expect(html).not.toContain('data-creator-account');
  });
  it('drops arbitrary fields and invalid display names from the display projection', () => {
    expect(parseCreatorSession({ signedIn: true, displayName: 'name', token: 'never-consume', isAdmin: true })).toEqual({ signedIn: true, displayName: 'name' });
    expect(parseCreatorSession({ signedIn: true, displayName: 'a'.repeat(81) })).toEqual({ signedIn: true, displayName: null });
    expect(parseCreatorSession({ signedIn: 'true' })).toEqual({ signedIn: false });
  });
  it('refreshes after returning from another tab and removes the prior account after sign out', async () => {
    const h = fixture();
    h.answer(0, { signedIn: true, displayName: 'A' }); await flush();
    h.advance(); h.window.dispatchEvent(new Event('focus')); h.document.dispatchEvent(new Event('visibilitychange'));
    expect(h.requests).toHaveLength(2);
    h.answer(1, { signedIn: false }); await flush();
    expect(h.seen).toEqual([{ signedIn: true, displayName: 'A' }, { signedIn: false }]); h.dispose();
  });
  it('ignores an old response if a newer account check has started', async () => {
    const h = fixture(); h.advance(); h.window.dispatchEvent(new Event('focus'));
    expect(h.requests[0]?.signal.aborted).toBe(true);
    h.answer(1, { signedIn: true, displayName: 'B' }); await flush();
    h.answer(0, { signedIn: true, displayName: 'A' }); await flush();
    expect(h.seen).toEqual([{ signedIn: true, displayName: 'B' }]); h.dispose();
  });
  it('cleans up pending work and listeners when the navigation unmounts', async () => {
    const h = fixture(); h.dispose(); h.answer(0, { signedIn: true, displayName: 'A' }); await flush();
    h.advance(); h.window.dispatchEvent(new Event('focus'));
    expect(h.requests).toHaveLength(1); expect(h.seen).toHaveLength(0);
  });
});
