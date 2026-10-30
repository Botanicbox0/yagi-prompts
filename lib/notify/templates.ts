import type { Localized } from '@/lib/content/schemas';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { interpolate, localize } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/config';
import { companyLine } from './company-line';
import type { NotifyKind } from './kinds';
import { buttonBlock, emailDocument, escapeHtml, metaBlock, noteBlock, paragraphBlock, titleBlock } from './layout';

/**
 * PLAN §3.5 — the two notification emails, bilingual by `profiles.locale`.
 *
 * Hand-rolled HTML strings rather than a runtime renderer: `react-email` is not a dependency and
 * §7 pins the dependency list, so adding one to produce two static layouts would be the expensive
 * way to get a worse result. What matters about an email is what it CONTAINS, and that is asserted
 * directly here (`tests/notify/templates.test.ts`).
 *
 * The content rule is the one that carries security weight: **an email carries card metadata only**
 * — title, summary, and for a rewrite the change note. Never a block, never a prompt, never a
 * parameter table, never a media URL. Gated bytes leaving the gate inside an email would defeat
 * every §3.4 server-side check at once, and an inbox is forwardable in a way a session is not. The
 * template's *inputs* are the enforcement: there is no parameter through which a block could arrive.
 *
 * Design: the shared layout, lib/notify/layout.ts.
 */

export interface NotificationContent {
  kind: NotifyKind;
  locale: Locale;
  title: Localized;
  summary: Localized;
  /** Present on a rewrite (the RPC requires it to republish); absent on a first publication. */
  changeNote: Localized | null;
}

export interface NotificationLinks {
  /** Absolute — an inbox has no origin to resolve a relative path against. */
  playbookUrl: string;
  unsubscribeUrl: string;
  accountUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export { escapeHtml };

function localizedOrEmpty(value: Localized | null, locale: Locale): string {
  return value === null ? '' : localize(value, locale).trim();
}

export function renderNotificationEmail(
  content: NotificationContent,
  links: NotificationLinks,
): RenderedEmail {
  const dict = getDictionary(content.locale);
  const copy = dict.email;
  const isUpdate = content.kind === 'playbook_update';

  const title = localize(content.title, content.locale).trim();
  const summary = localize(content.summary, content.locale).trim();
  // A change note only appears on an update, whatever the caller passed — the kind is the truth.
  const changeNote = isUpdate ? localizedOrEmpty(content.changeNote, content.locale) : '';

  const subject = interpolate(isUpdate ? copy.updateSubject : copy.newSubject, { title });
  const eyebrow = isUpdate ? copy.updateEyebrow : copy.newEyebrow;
  const preheader = isUpdate ? copy.updatePreheader : copy.newPreheader;

  // The wordmark is the dictionary's, not a literal: one brand token, shared with the nav.
  const siteName = dict.meta.siteName;

  return {
    subject,
    html: emailDocument({
      locale: content.locale,
      preheader,
      siteName,
      kicker: eyebrow,
      blocks: [
        titleBlock(title),
        paragraphBlock(summary),
        ...(changeNote === '' ? [] : [metaBlock(`${copy.changeNoteHeading}: ${changeNote}`)]),
        buttonBlock(copy.cta, links.playbookUrl),
        noteBlock(copy.signOff, { label: copy.unsubscribe, url: links.unsubscribeUrl }),
        noteBlock('', { label: copy.manage, url: links.accountUrl }, 4),
      ],
      footer: [companyLine(content.locale)],
    }),
    text: text({ eyebrow, title, summary, changeNote, copy, links, siteName }),
  };
}

interface Parts {
  siteName: string;
  eyebrow: string;
  title: string;
  summary: string;
  changeNote: string;
  copy: ReturnType<typeof getDictionary>['email'];
  links: NotificationLinks;
}

function text(parts: Parts): string {
  const { eyebrow, title, summary, changeNote, copy, links, siteName } = parts;
  const lines = [
    `${siteName} — ${eyebrow}`,
    '',
    title,
    '',
    summary,
  ];
  if (changeNote !== '') lines.push('', `${copy.changeNoteHeading}: ${changeNote}`);
  lines.push(
    '',
    `${copy.cta}: ${links.playbookUrl}`,
    '',
    '—',
    copy.signOff,
    `${copy.unsubscribe}: ${links.unsubscribeUrl}`,
    `${copy.manage}: ${links.accountUrl}`,
  );
  return lines.join('\n');
}
