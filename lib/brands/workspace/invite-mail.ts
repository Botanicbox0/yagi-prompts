/**
 * Transactional e-mail delivery for workspace team invitations (`invitation.create`),
 * gated behind `BRAND_ORG_INVITE_EMAIL=on` (default off).
 *
 * Reuses the exact transactional sheet + company line + mailer boundary of
 * `lib/brand-rooms/invites.ts`. Never throws: records `mail_state` (`'sent' | 'failed' | 'skipped'`)
 * and `mail_sent_at` on `brand_invites` and returns the state so the caller still hands back the
 * manual invite link when email is skipped or fails.
 */
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { Mailer } from '@/lib/notify/mailer';
import { sheet, sheetText, type SheetArgs } from '@/lib/notify/sheet';
import { companyLine } from '@/lib/notify/company-line';
import { brandSiteUrl } from '@/lib/seo/site-url';
import { getDictionary } from '@/lib/i18n/dictionaries';
import type { BrandRole } from './types';

export type OrgInviteMailState = 'sent' | 'failed' | 'skipped';

const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? values[k]! : m));

function longDate(at: Date, locale: 'ko' | 'en'): string {
  return new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Seoul',
  }).format(at);
}

export function orgInviteAcceptPath(token: string): string {
  return `/brand/invite#token=${encodeURIComponent(token)}`;
}

export function buildOrgInviteEmail(input: {
  locale: 'ko' | 'en';
  token: string;
  organizationName: string;
  inviterName: string;
  role: BrandRole;
  expiresAt: Date;
  env?: NodeJS.ProcessEnv;
}): { subject: string; html: string; text: string; buttonUrl: string } {
  const env = input.env ?? process.env;
  const b = getDictionary(input.locale).brandWorkspace;
  const copy = b.inviteMail;
  const roleLabel = b.roles[input.role] ?? input.role;
  const vars = {
    inviter: input.inviterName,
    organization: input.organizationName,
    role: roleLabel,
    date: longDate(input.expiresAt, input.locale),
  };
  const buttonUrl = `${brandSiteUrl(env)}${orgInviteAcceptPath(input.token)}`;
  const args: SheetArgs = {
    title: fill(copy.heading, vars),
    paragraphs: [fill(copy.body, vars), fill(copy.expiry, vars), copy.personal],
    button: { label: copy.button, url: buttonUrl },
    note: { text: fill(copy.why, vars) },
    footer: companyLine(input.locale, { address: true }),
  };
  return {
    subject: fill(copy.subject, vars),
    html: sheet(args),
    text: sheetText(args),
    buttonUrl,
  };
}

export async function deliverOrgInviteEmail(input: {
  sql: SqlRunner;
  mailer: Mailer | null;
  inviteId: string;
  organizationId: string;
  inviterUserId: string;
  email: string;
  role: BrandRole;
  token: string;
  locale: 'ko' | 'en';
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): Promise<OrgInviteMailState> {
  const timeoutMs = input.timeoutMs ?? 8000;
  try {
    const [orgRow, profileRow, inviteRow] = await Promise.all([
      input.sql
        .query<{ name: string }>('select name from brand_organizations where id = $1', [input.organizationId])
        .then((r) => r.rows[0]),
      input.sql
        .query<{ display_name: string | null; email: string | null }>(
          'select display_name, email from profiles where id = $1',
          [input.inviterUserId],
        )
        .then((r) => r.rows[0]),
      input.sql
        .query<{ expires_at: Date | string }>('select expires_at from brand_invites where id = $1', [input.inviteId])
        .then((r) => r.rows[0]),
    ]);

    const organizationName = orgRow?.name?.trim() || 'TWINGS';
    const inviterName = profileRow?.display_name?.trim() || profileRow?.email?.trim() || 'Team';
    const expiresAt = inviteRow?.expires_at ? new Date(String(inviteRow.expires_at)) : new Date(Date.now() + 7 * 86_400_000);

    let state: OrgInviteMailState = 'skipped';
    if (input.mailer) {
      const built = buildOrgInviteEmail({
        locale: input.locale,
        token: input.token,
        organizationName,
        inviterName,
        role: input.role,
        expiresAt,
        env: input.env,
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const outcome = await Promise.race([
          input.mailer.send({
            to: input.email,
            subject: built.subject,
            html: built.html,
            text: built.text,
            idempotencyKey: `org-invite:${input.inviteId}`,
            unsubscribeUrl: '',
          }),
          new Promise<{ ok: false; retryable: true; error: string }>((resolve) => {
            timer = setTimeout(() => resolve({ ok: false, retryable: true, error: 'timeout' }), timeoutMs);
          }),
        ]);
        state = outcome.ok ? 'sent' : 'failed';
      } catch {
        state = 'failed';
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    await input.sql.query(
      "update brand_invites set mail_state = $2, mail_sent_at = case when $2 = 'sent' then now() else null end where id = $1",
      [input.inviteId, state],
    );

    return state;
  } catch {
    return 'failed';
  }
}
