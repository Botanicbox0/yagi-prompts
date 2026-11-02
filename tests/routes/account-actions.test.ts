import { beforeEach, describe, expect, it, vi } from 'vitest';
const context = vi.hoisted(() => ({ userId: 'verified-owner' as string | null, preferences: vi.fn(), name: vi.fn() }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: async () => ({ userId: context.userId, tier: 'free' }) }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => ({}) }));
vi.mock('@/lib/notify/preferences', () => ({ savePreferences: context.preferences }));
vi.mock('@/lib/creators/profile', () => ({ saveCreatorDisplayName: context.name }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
import { saveNotificationPreferences, saveCreatorProfile } from '@/app/(app)/account/actions';

describe('creator account actions', () => {
  beforeEach(() => { context.userId = 'verified-owner'; context.preferences.mockReset().mockResolvedValue(true); context.name.mockReset().mockResolvedValue(true); });
  it('allows a signed-in free creator to save the campaign alerts offered by the UI', async () => {
    const form = new FormData(); form.set('notifUpdates', 'on');
    await expect(saveNotificationPreferences(form)).rejects.toThrow('redirect:/account?notif=saved');
    expect(context.preferences).toHaveBeenCalledWith({}, 'verified-owner', { newPlaybook: false, updates: true });
  });
  it('uses the verified account, not submitted identity or role fields', async () => {
    const form = new FormData(); form.set('displayName', 'Name'); form.set('userId', 'someone-else'); form.set('isAdmin', 'true'); form.set('snsUrl', 'https://instagram.com/other');
    await expect(saveCreatorProfile(form)).rejects.toThrow('redirect:/account?profile=saved');
    expect(context.name).toHaveBeenCalledWith({}, 'verified-owner', 'Name');
  });
  it('does not write for an anonymous request', async () => {
    context.userId = null;
    await expect(saveCreatorProfile(new FormData())).rejects.toThrow('redirect:/account');
    await expect(saveNotificationPreferences(new FormData())).rejects.toThrow('redirect:/account');
    expect(context.name).not.toHaveBeenCalled(); expect(context.preferences).not.toHaveBeenCalled();
  });
});
