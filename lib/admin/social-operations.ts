import type { AdminOperation } from './operations';
import { fail, ok } from './context';
import { parseFollowerCount } from '@/lib/influencers/rules';
import { rejectSocialAccount, verifySocialAccount } from '@/lib/influencers/admin';

/**
 * docs/PLATFORM-2.0.md §17.1 — the two decisions of the "SNS 확인" queue, in the one registry so the
 * admin auth enumeration covers them. The follower count is TYPED by the administrator: an empty
 * field is refused, whatever the model suggested.
 */
const BACK = '/admin/community#social';
const str = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
};

const verify: AdminOperation<{ id: string; followerCount: number }> = {
  parse(form) {
    const count = parseFollowerCount(str(form, 'followerCount'));
    if (count === null || count === undefined) return { ok: false, detail: 'followerCount: required' };
    return { ok: true, value: { id: str(form, 'id'), followerCount: count } };
  },
  async run(ctx, input) {
    const r = await verifySocialAccount(ctx.sql, ctx.viewer, input);
    // 'saved', not 'verified': that banner speaks about campaign posts and their 7-day hold.
    return r.ok ? ok('saved', { to: BACK }) : fail(r.code);
  },
};

const reject: AdminOperation<{ id: string; reason: string }> = {
  parse(form) {
    const reason = str(form, 'reason').trim();
    if (!reason) return { ok: false, detail: 'reason: required' };
    return { ok: true, value: { id: str(form, 'id'), reason } };
  },
  async run(ctx, input) {
    const r = await rejectSocialAccount(ctx.sql, ctx.viewer, input);
    return r.ok ? ok('rejected', { to: BACK }) : fail(r.code);
  },
};

export const SOCIAL_OPERATIONS = {
  'social.verify': verify,
  'social.reject': reject,
} as const;
