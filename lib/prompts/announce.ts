import type { SqlRunner } from '@/lib/db/sql-runner';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { interpolate } from '@/lib/i18n/format';
import { BUSINESS } from '@/lib/legal/documents';
import type { Mailer } from '@/lib/notify/mailer';
import { broadcast, type BroadcastResult } from '@/lib/notify/broadcast';
import { sheet, sheetText } from '@/lib/notify/sheet';
import { formatTemplatePrice } from '@/lib/twings/products';
import { templateHref } from './links';
import type { PromptRow } from './repo';

/**
 * The weekly drop's alert (founder, 2026-09-13: the drop itself is manual; the mail is one button).
 * Everyone with "새 템플릿 알림" on (`notif_new_playbook`) gets one mail about one template, once —
 * the operation stamps `announced_at` first and refuses a second press (lib/admin/prompt-operations).
 */
export async function announceTemplate(deps: { sql: SqlRunner; mailer: Mailer | null; siteUrl: string }, row: PromptRow): Promise<BroadcastResult> {
  const origin = deps.siteUrl.replace(/\/+$/, '');
  return broadcast(
    { sql: deps.sql, mailer: deps.mailer, siteUrl: origin },
    {
      toggle: 'notif_new_playbook',
      eventKey: `template:${row.id}:announce`,
      compose(subscriber, unsubscribeUrl) {
        const locale = subscriber.locale;
        const dict = getDictionary(locale);
        const t = dict.templates.announce;
        const title = locale === 'ko' && row.titleKo ? row.titleKo : row.title;
        const price = formatTemplatePrice(
          { priceCents: row.priceCents, priceKrw: row.priceKrw, medium: row.medium } as Parameters<typeof formatTemplatePrice>[0],
          locale,
        );
        const vars = { title, price, medium: dict.nav[row.medium] };
        const args = {
          title: t.title,
          paragraphs: [interpolate(t.body, vars)],
          button: { label: t.cta, url: `${origin}${templateHref(locale, row.slug)}` },
          note: { text: t.unsubscribeLine, link: { label: t.unsubscribeCta, url: unsubscribeUrl } },
          footer: `${t.footer} · ${BUSINESS.nameKo} · ${BUSINESS.email}`,
        };
        return { subject: interpolate(t.subject, vars), html: sheet(args), text: sheetText(args) };
      },
    },
  );
}

/** Stamp the one-shot guard. Returns false when it was already stamped — the caller must not send. */
export async function markPromptAnnounced(sql: SqlRunner, id: string): Promise<boolean> {
  const { rows } = await sql.query<{ id: string }>(
    `update prompt_items set announced_at = now() where id = $1 and announced_at is null and status = 'published' and audience = 'public' returning id`,
    [id],
  );
  return rows.length > 0;
}
