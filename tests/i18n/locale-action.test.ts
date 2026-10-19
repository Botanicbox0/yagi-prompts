import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  setCookie: vi.fn(),
  after: vi.fn(),
  user: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: state.setCookie }) }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock('next/server', () => ({ after: state.after }));
vi.mock('@/lib/supabase/auth-client', () => ({ getSessionUser: state.user }));
vi.mock('@/lib/supabase/data-client', () => ({
  createDataClient: () => ({ from: () => ({ update: state.update }) }),
}));

import { setLocaleAction } from '@/app/actions/locale';
import { LOCALE_COOKIE } from '@/lib/i18n/config';

function choice(locale = 'ko', next = '/ko/video') {
  const form = new FormData();
  form.set('locale', locale);
  form.set('next', next);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.user.mockReset();
  state.eq.mockReset();
  state.user.mockResolvedValue({ id: 'verified-user' });
  state.update.mockReturnValue({ eq: state.eq });
  state.eq.mockResolvedValue({ error: null });
});

describe('locale selection navigation', () => {
  it('writes the choice and redirects without waiting for authentication or profile storage', async () => {
    await expect(setLocaleAction(choice())).rejects.toThrow('redirect:/ko/video');
    expect(state.setCookie).toHaveBeenCalledWith(LOCALE_COOKIE, 'ko', expect.objectContaining({ path: '/' }));
    expect(state.user).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
    expect(state.after).toHaveBeenCalledOnce();

    await state.after.mock.calls[0]![0]();
    expect(state.update).toHaveBeenCalledWith({ locale: 'ko' });
    expect(state.eq).toHaveBeenCalledWith('id', 'verified-user');
  });

  it('keeps anonymous navigation independent of profile storage', async () => {
    state.user.mockResolvedValue(null);
    await expect(setLocaleAction(choice('en', '/account?tab=profile'))).rejects.toThrow('redirect:/account?tab=profile');
    await state.after.mock.calls[0]![0]();
    expect(state.update).not.toHaveBeenCalled();
  });

  it('tolerates authentication or profile failures after the response', async () => {
    await expect(setLocaleAction(choice())).rejects.toThrow('redirect:/ko/video');
    state.user.mockRejectedValueOnce(new Error('auth unavailable'));
    await expect(state.after.mock.calls[0]![0]()).resolves.toBeUndefined();
    state.eq.mockRejectedValueOnce(new Error('profile unavailable'));
    await expect(state.after.mock.calls[0]![0]()).resolves.toBeUndefined();
  });

  it('rejects unsupported locales without changing any preference', async () => {
    await expect(setLocaleAction(choice('fr'))).rejects.toThrow('redirect:/ko/video');
    expect(state.setCookie).not.toHaveBeenCalled();
    expect(state.after).not.toHaveBeenCalled();
  });

  it('never redirects to a user-supplied external origin', async () => {
    await expect(setLocaleAction(choice('ko', 'https://example.com/'))).rejects.toThrow('redirect:/');
  });
});
