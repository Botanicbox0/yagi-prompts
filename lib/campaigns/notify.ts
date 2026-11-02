import type { SqlRunner } from '@/lib/db/sql-runner';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { interpolate, localize } from '@/lib/i18n/format';
import { formatCampaignDateTime } from '@/lib/campaigns/dates';
import { companyLine } from '@/lib/notify/company-line';
import type { Mailer, SendOutcome } from '@/lib/notify/mailer';
import { broadcast, type BroadcastResult } from '@/lib/notify/broadcast';
import { sheet, sheetText } from '@/lib/notify/sheet';
import { campaignLabels } from '@/components/campaigns/labels';
import { payoutHeadline } from './copy';
import { MY_CAMPAIGNS_PATH, campaignHref, campaignsHref } from './links';
import { loadCampaignsByIds, type ApplicationRow, type CampaignRow } from './repo';
import { unsubscribePath } from '@/lib/notify/unsubscribe';
import { formatWon } from './state';

/**
 * Campaign mail (founder, 2026-09-13: "크리에이터와 브랜드 사이드도 필요한 기능들").
 *
 *   · `announceCampaignRecruiting` — a campaign moves to `recruiting`: everyone with the campaign
 *     switch on ("캠페인 알림" = `notif_updates`) hears about it once. A broadcast, with one-click
 *     unsubscribe per person.
 *   · `notifyApplicationStatus` — the studio selects / declines / verifies / rejects / pays: the
 *     one creator concerned hears about it. Transactional, so no toggle gates it; the note points
 *     at the account page.
 *
 * Both are called from the admin operations through `ctx.defer` — after the redirect, never on
 * the request path. Idempotency keys make a retried run harmless.
 */

export interface CampaignMailDeps {
  sql: SqlRunner;
  mailer: Mailer | null;
  siteUrl: string;
}

/** The statuses a creator is told about. `withdrawn`/`expired` are their own doing or the clock's. */
export const NOTIFIED_APPLICATION_STATUSES = ['selected', 'declined', 'verified', 'rejected', 'paid'] as const;
export type NotifiedApplicationStatus = (typeof NOTIFIED_APPLICATION_STATUSES)[number];

function footer(locale: Locale): string {
  const dict = getDictionary(locale);
  return `${dict.campaigns.email.footer} · ${companyLine(locale)}`;
}

/** What a campaign says about itself in one line, in the reader's language. */
function campaignFacts(campaign: CampaignRow, locale: Locale): { title: string; payout: string; applyBy: string } {
  const dict = getDictionary(locale);
  const labels = campaignLabels(dict);
  return {
    title: localize(campaign.title, locale).replace(/\s+/g, ' ').trim(),
    payout: campaign.payout ? payoutHeadline(campaign.payout, locale, labels.payout) : '',
    applyBy: campaign.applicationsCloseAt ? (formatCampaignDateTime(campaign.applicationsCloseAt, locale) ?? '') : '',
  };
}

export async function announceCampaignRecruiting(deps: CampaignMailDeps, campaign: CampaignRow): Promise<BroadcastResult> {
  const origin = deps.siteUrl.replace(/\/+$/, '');
  return broadcast(
    { sql: deps.sql, mailer: deps.mailer, siteUrl: origin },
    {
      toggle: 'notif_updates',
      eventKey: `campaign:${campaign.id}:recruiting`,
      compose(subscriber, unsubscribeUrl) {
        const locale = subscriber.locale;
        const dict = getDictionary(locale);
        const c = dict.campaigns.email;
        const facts = campaignFacts(campaign, locale);
        const vars = { title: facts.title, host: campaign.hostName, slots: String(campaign.slots), applyBy: facts.applyBy };
        const args = {
          title: c.recruitingTitle,
          paragraphs: [interpolate(c.recruitingBody, vars)],
          button: { label: c.recruitingCta, url: `${origin}${campaignHref(locale, campaign.slug)}` },
          note: { text: c.unsubscribeLine, link: { label: c.unsubscribeCta, url: unsubscribeUrl } },
          footer: footer(locale),
        };
        return { subject: interpolate(c.recruitingSubject, vars), html: sheet(args), text: sheetText(args) };
      },
    },
  );
}

interface Recipient {
  email: string | null;
  locale: Locale;
}

async function recipientFor(sql: SqlRunner, userId: string): Promise<Recipient> {
  const { rows } = await sql.query<{ email: string | null; locale: string | null }>('select email, locale from profiles where id = $1', [userId]);
  const row = rows[0];
  return { email: row?.email ?? null, locale: isLocale(row?.locale) ? row.locale : DEFAULT_LOCALE };
}

export async function notifyApplicationStatus(
  deps: CampaignMailDeps,
  args: { app: ApplicationRow; campaign: CampaignRow; status: NotifiedApplicationStatus },
): Promise<SendOutcome | null> {
  if (deps.mailer === null) return null;
  const recipient = await recipientFor(deps.sql, args.app.creatorId);
  if (recipient.email === null) return { ok: false, retryable: false, error: 'the profile has no email' };
  const locale = recipient.locale;
  const dict = getDictionary(locale);
  const c = dict.campaigns.email;
  const origin = deps.siteUrl.replace(/\/+$/, '');
  const facts = campaignFacts(args.campaign, locale);
  const postBy = args.campaign.postDeadlineAt ? (formatCampaignDateTime(args.campaign.postDeadlineAt, locale) ?? '') : '';
  const amount = args.app.payoutCents !== null ? formatWon(args.app.payoutCents, locale) : '';
  const vars = { title: facts.title, host: args.campaign.hostName, postBy, reason: args.app.rejectReason ?? '', amount, payout: facts.payout };
  const mine = `${origin}${MY_CAMPAIGNS_PATH}`;
  const sheetArgs = {
    title: c.statusTitle[args.status],
    paragraphs: [interpolate(c.statusBody[args.status], vars)],
    button: { label: c.statusCta[args.status], url: args.status === 'declined' ? `${origin}${campaignsHref(locale)}` : mine },
    note: { text: c.transactionalLine, link: { label: c.accountCta, url: `${origin}/account` } },
    footer: footer(locale),
  };
  return deps.mailer
    .send({
      to: recipient.email,
      subject: interpolate(c.statusSubject[args.status], vars),
      html: sheet(sheetArgs),
      text: sheetText(sheetArgs),
      // The version is the moderation form's concurrency token: one transition, one mail.
      idempotencyKey: `application:${args.app.id}:${args.status}:${args.app.version}`,
      unsubscribeUrl: `${origin}/account`,
    })
    .catch((error: unknown): SendOutcome => ({ ok: false, retryable: false, error: error instanceof Error ? error.message : String(error) }));
}

/**
 * A brand invited this person from the creator pool (docs/PLATFORM-2.0.md §17.3). One mail per
 * invitation, only to people with campaign mail on (`notif_updates`, the same switch as
 * recruiting announcements, with its one-click unsubscribe). The button is the invitation link
 * itself, which only this account can accept. Sent after the brand's response, never on it.
 */
export async function notifyCampaignInvitation(
  deps: CampaignMailDeps,
  args: { campaignId: string; userId: string; invitationId: string; token: string },
): Promise<SendOutcome | null> {
  if (deps.mailer === null) return null;
  const { rows } = await deps.sql.query<{ email: string | null; locale: string | null; notif_updates: boolean }>(
    'select email, locale, notif_updates from profiles where id = $1',
    [args.userId],
  );
  const person = rows[0];
  if (!person || person.notif_updates !== true || !person.email?.includes('@')) return null;
  const [campaign] = await loadCampaignsByIds(deps.sql, [args.campaignId]);
  if (!campaign) return null;
  const locale: Locale = isLocale(person.locale) ? person.locale : DEFAULT_LOCALE;
  const c = getDictionary(locale).campaigns.email;
  const origin = deps.siteUrl.replace(/\/+$/, '');
  const facts = campaignFacts(campaign, locale);
  const vars = { title: facts.title, host: campaign.hostName, applyBy: facts.applyBy, payout: facts.payout };
  const unsubscribeUrl = `${origin}${unsubscribePath({ userId: args.userId, toggle: 'notif_updates' })}`;
  const sheetArgs = {
    title: c.invitedTitle,
    paragraphs: [interpolate(c.invitedBody, vars)],
    button: { label: c.invitedCta, url: `${origin}/campaigns/${encodeURIComponent(campaign.slug)}/join#token=${args.token}` },
    note: { text: c.unsubscribeLine, link: { label: c.unsubscribeCta, url: unsubscribeUrl } },
    footer: footer(locale),
  };
  return deps.mailer
    .send({
      to: person.email,
      subject: interpolate(c.invitedSubject, vars),
      html: sheet(sheetArgs),
      text: sheetText(sheetArgs),
      idempotencyKey: `campaign-invitation:${args.invitationId}`,
      unsubscribeUrl,
    })
    .catch((error: unknown): SendOutcome => ({ ok: false, retryable: false, error: error instanceof Error ? error.message : String(error) }));
}
