import { getDictionary } from '@/lib/i18n/dictionaries';
import type { Locale } from '@/lib/i18n/config';
import { escapeHtml } from './templates';
import type { NotifyToggle } from './kinds';

/**
 * The confirmation page `/api/notify/unsubscribe` renders.
 *
 * It is a hand-written document rather than a React route because of where it is reached FROM: a
 * mail client, with no session, possibly on a phone, possibly weeks later. It must render with no
 * JavaScript, no fonts to load and no data to fetch — and it must never look like an error when it
 * worked. So: one file, inline CSS in the §5.1 two-inks language, and a sentence that says what
 * just happened and how to undo it.
 *
 * Bilingual by the PROFILE's locale (the same signal the email used), not by Accept-Language: the
 * reader is arriving from an email they read in one particular language.
 */

export interface UnsubscribePageInput {
  locale: Locale;
  toggle: NotifyToggle;
}

const SHELL_STYLE =
  'margin:0;background:#FFFFFF;color:#000000;font-family:-apple-system,BlinkMacSystemFont,' +
  "'Segoe UI','Apple SD Gothic Neo','Malgun Gothic',Roboto,Helvetica,Arial,sans-serif;";
const MONO = "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,monospace";
const BLUE = '#0000EE';

function shell(locale: Locale, title: string, body: string): string {
  // Same brand token as the nav and the emails — the dictionary, never a literal.
  const siteName = escapeHtml(getDictionary(locale).meta.siteName);
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)} · ${siteName}</title>
</head>
<body style="${SHELL_STYLE}">
<main style="max-width:34rem;margin:0 auto;padding:14vh 24px 24px;">
  <p style="margin:0 0 40px 0;font-family:${MONO};font-size:11px;letter-spacing:0.12em;text-transform:uppercase;">${siteName}</p>
  ${body}
</main>
</body>
</html>`;
}

export function renderUnsubscribed(input: UnsubscribePageInput): string {
  const dict = getDictionary(input.locale);
  const copy = dict.unsubscribe;
  const done = input.toggle === 'notif_new_playbook' ? copy.doneNew : copy.doneUpdates;

  return shell(
    input.locale,
    copy.title,
    `<h1 style="margin:0 0 20px 0;font-size:34px;line-height:1.05;font-weight:800;text-transform:uppercase;">${escapeHtml(
      copy.title,
    )}</h1>
  <p style="margin:0 0 12px 0;font-size:16px;line-height:1.6;">${escapeHtml(done)}</p>
  <p style="margin:0 0 32px 0;font-size:16px;line-height:1.6;opacity:0.65;">${escapeHtml(
    copy.reversible,
  )}</p>
  <p style="margin:0;font-family:${MONO};font-size:12px;line-height:2;">
    <a href="/account" style="color:${BLUE};">${escapeHtml(copy.manage)} &rarr;</a><br>
    <a href="/${input.locale}" style="color:#000000;opacity:0.55;text-decoration:none;">${escapeHtml(
      copy.home,
    )}</a>
  </p>`,
  );
}

/** A token that was truncated, forged, or signed with a key this deployment no longer has. */
export function renderUnsubscribeInvalid(locale: Locale): string {
  const dict = getDictionary(locale);
  const copy = dict.unsubscribe;

  return shell(
    locale,
    copy.invalidTitle,
    `<h1 style="margin:0 0 20px 0;font-size:34px;line-height:1.05;font-weight:800;text-transform:uppercase;">${escapeHtml(
      copy.invalidTitle,
    )}</h1>
  <p style="margin:0 0 32px 0;font-size:16px;line-height:1.6;opacity:0.75;">${escapeHtml(
    copy.invalidBody,
  )}</p>
  <p style="margin:0;font-family:${MONO};font-size:12px;line-height:2;">
    <a href="/account" style="color:${BLUE};">${escapeHtml(copy.manage)} &rarr;</a><br>
    <a href="/${locale}" style="color:#000000;opacity:0.55;text-decoration:none;">${escapeHtml(
      copy.home,
    )}</a>
  </p>`,
  );
}
