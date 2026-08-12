import type { Localized } from '@/lib/content/schemas';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { interpolate, localize } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/config';
import type { NotifyKind } from './kinds';

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
 * Design: §5.1's two inks and one accent, in the subset of CSS that survives a mail client —
 * inline styles, a table for the button, system font stacks (self-hosted WOFF2 cannot travel).
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

const BLACK = '#000000';
const WHITE = '#FFFFFF';
/** §5.1: the classic hyperlink blue, the ONE accent. Email bodies are white surfaces. */
const BLUE = '#0000EE';
const HAIRLINE = 'rgba(0,0,0,0.12)';

const BODY_FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Apple SD Gothic Neo', 'Malgun Gothic', Roboto, Helvetica, Arial, sans-serif";
const MONO_FONT = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace";

/** Titles and summaries are author-supplied text going into markup. Escape, always. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
    html: html({ eyebrow, preheader, title, summary, changeNote, copy, links, siteName }),
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

function html(parts: Parts & { preheader: string }): string {
  const { eyebrow, preheader, title, summary, changeNote, copy, links, siteName } = parts;

  const changeNoteBlock =
    changeNote === ''
      ? ''
      : `
      <tr><td style="padding:0 0 28px 0;">
        <div style="border-left:2px solid ${BLACK};padding:2px 0 2px 16px;">
          <p style="margin:0 0 6px 0;font-family:${MONO_FONT};font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${BLACK};opacity:0.55;">${escapeHtml(
            copy.changeNoteHeading,
          )}</p>
          <p style="margin:0;font-family:${BODY_FONT};font-size:15px;line-height:1.6;color:${BLACK};">${escapeHtml(
            changeNote,
          )}</p>
        </div>
      </td></tr>`;

  return `<!-- ${escapeHtml(preheader)} -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${WHITE};margin:0;padding:0;">
  <tr><td align="center" style="padding:40px 20px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
      <tr><td style="padding:0 0 32px 0;border-bottom:1px solid ${HAIRLINE};">
        <p style="margin:0;font-family:${MONO_FONT};font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${BLACK};">${escapeHtml(siteName)}</p>
      </td></tr>

      <tr><td style="padding:32px 0 8px 0;">
        <p style="margin:0;font-family:${MONO_FONT};font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${BLUE};">${escapeHtml(
          eyebrow,
        )}</p>
      </td></tr>

      <tr><td style="padding:0 0 20px 0;">
        <h1 style="margin:0;font-family:${BODY_FONT};font-size:30px;line-height:1.1;font-weight:800;color:${BLACK};">${escapeHtml(
          title,
        )}</h1>
      </td></tr>

      <tr><td style="padding:0 0 28px 0;">
        <p style="margin:0;font-family:${BODY_FONT};font-size:16px;line-height:1.6;color:${BLACK};opacity:0.75;">${escapeHtml(
          summary,
        )}</p>
      </td></tr>
${changeNoteBlock}
      <tr><td style="padding:0 0 36px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="border:1px solid ${BLACK};">
            <a href="${escapeHtml(
              links.playbookUrl,
            )}" style="display:inline-block;padding:14px 26px;font-family:${MONO_FONT};font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:${BLACK};text-decoration:none;">${escapeHtml(
              copy.cta,
            )} &rarr;</a>
          </td></tr>
        </table>
      </td></tr>

      <tr><td style="padding:24px 0 0 0;border-top:1px solid ${HAIRLINE};">
        <p style="margin:0 0 10px 0;font-family:${BODY_FONT};font-size:13px;line-height:1.6;color:${BLACK};opacity:0.55;">${escapeHtml(
          copy.signOff,
        )}</p>
        <p style="margin:0;font-family:${MONO_FONT};font-size:12px;line-height:1.8;">
          <a href="${escapeHtml(
            links.unsubscribeUrl,
          )}" style="color:${BLUE};text-decoration:underline;">${escapeHtml(copy.unsubscribe)}</a>
          <span style="color:${BLACK};opacity:0.35;"> &middot; </span>
          <a href="${escapeHtml(
            links.accountUrl,
          )}" style="color:${BLACK};opacity:0.55;text-decoration:none;">${escapeHtml(
            copy.manage,
          )}</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>`;
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
