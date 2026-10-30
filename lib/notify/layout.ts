/**
 * The one mail layout (docs/MEMBER-NOTIFICATIONS.md §5). Every message TWINGS sends renders through
 * `emailDocument`, so a change of tone is one edit and no mail can drift to its own palette.
 *
 * Colours are docs/design/IDENTITY.md §2 by role: white paper on a cool canvas, one French blue,
 * no red. Mail clients cannot read CSS variables or load Pretendard, hence the literal values and
 * the system fallbacks. What keeps it working in a mail client: tables for structure, inline styles
 * for everything, a `bgcolor` on the button cell, a fixed-width table for Outlook's Word engine.
 * Dark mode is the one thing in a `<style>` block, and only as an enhancement: a client that drops
 * the block shows the light mail, which is readable everywhere.
 */

export const EMAIL_COLOUR = {
  paper: '#ffffff',
  canvas: '#f6f7f9',
  ink: '#0e1013',
  body: '#41444d',
  muted: '#676b75',
  line: '#e4e6ea',
  accent: '#3875c5',
  /** IDENTITY.md "글자용 블루": small blue type needs the deeper mix to stay readable. */
  accentText: '#3063a7',
  /** Dark mode. Same roles, and white text on the accent still reads 4.65:1. */
  darkCanvas: '#0e1013',
  darkPaper: '#181b20',
  darkInk: '#f6f7f9',
  darkBody: '#c7ccd3',
  darkMuted: '#9a9fa8',
  darkLine: '#2c3037',
  darkAccentText: '#8fb6e8',
} as const;

const C = EMAIL_COLOUR;

export const EMAIL_FONT =
  "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Author-supplied text going into markup. Escape, always. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const WIDTH = 560;
const GUTTER = 32;
/** The width an image can fill inside the card. */
export const EMAIL_CONTENT_WIDTH = WIDTH - GUTTER * 2;

function cell(padding: string, inner: string): string {
  // keep-all: Korean breaks between words, not inside one.
  return `<tr><td class="tw-gutter" style="padding:${padding};word-break:keep-all;">${inner}</td></tr>`;
}

export function titleBlock(text: string): string {
  return cell(
    `28px ${GUTTER}px 0`,
    `<h1 class="tw-ink" style="margin:0;font-family:${EMAIL_FONT};font-size:26px;line-height:1.25;font-weight:600;letter-spacing:-0.02em;color:${C.ink};">${escapeHtml(text)}</h1>`,
  );
}

export function paragraphBlock(text: string): string {
  return cell(
    `12px ${GUTTER}px 0`,
    `<p class="tw-body" style="margin:0;font-family:${EMAIL_FONT};font-size:15px;line-height:1.65;color:${C.body};white-space:pre-wrap;">${escapeHtml(text)}</p>`,
  );
}

export function metaBlock(text: string): string {
  return cell(
    `16px ${GUTTER}px 0`,
    `<p class="tw-muted" style="margin:0;font-family:${EMAIL_FONT};font-size:13px;line-height:1.6;color:${C.muted};">${escapeHtml(text)}</p>`,
  );
}

/** A hairline-ruled label/value list: the receipt's choices, the studio's enquiry fields. */
export function rowsBlock(rows: ReadonlyArray<readonly [string, string]>): string {
  if (rows.length === 0) return '';
  const body = rows
    .map(
      ([k, v]) =>
        `<tr><td class="tw-muted tw-rule" style="padding:10px 16px 10px 0;border-top:1px solid ${C.line};font-family:${EMAIL_FONT};font-size:13px;line-height:1.5;color:${C.muted};vertical-align:top;white-space:nowrap;">${escapeHtml(k)}</td><td class="tw-ink tw-rule" style="padding:10px 0;border-top:1px solid ${C.line};font-family:${EMAIL_FONT};font-size:14px;line-height:1.5;color:${C.ink};white-space:pre-wrap;">${escapeHtml(v)}</td></tr>`,
    )
    .join('');
  return cell(
    `20px ${GUTTER}px 0`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${body}</table>`,
  );
}

/** The one button: a pill in the accent. White on French blue, nothing else goes on it. */
export function buttonBlock(label: string, url: string): string {
  return cell(
    `28px ${GUTTER}px 0`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${C.accent}" style="background:${C.accent};border-radius:999px;"><a href="${escapeHtml(url)}" style="display:inline-block;padding:14px 28px;font-family:${EMAIL_FONT};font-size:15px;line-height:1.2;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">${escapeHtml(label)}</a></td></tr></table>`,
  );
}

/** A small line, optionally ending in a link: the unsubscribe sentence, a "not happy?". */
export function noteBlock(text: string, link?: { label: string; url: string } | null, top = 24): string {
  const anchor = link
    ? ` <a class="tw-link" href="${escapeHtml(link.url)}" style="color:${C.accentText};text-decoration:underline;">${escapeHtml(link.label)}</a>`
    : '';
  return cell(
    `${top}px ${GUTTER}px 0`,
    `<p class="tw-muted" style="margin:0;font-family:${EMAIL_FONT};font-size:13px;line-height:1.6;color:${C.muted};">${escapeHtml(text)}${anchor}</p>`,
  );
}

/** A result picture. `alt` stays empty when the sentence next to it already says what it is. */
export function imageBlock(src: string, href: string, alt = ''): string {
  return cell(
    `24px ${GUTTER}px 0`,
    `<a href="${escapeHtml(href)}" style="display:block;text-decoration:none;"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" width="${EMAIL_CONTENT_WIDTH}" style="display:block;width:100%;max-width:${EMAIL_CONTENT_WIDTH}px;height:auto;border:0;border-radius:18px;" /></a>`,
  );
}

/** A row of equal thumbnails under the preview, each opening the same link. */
export function thumbnailsBlock(srcs: readonly string[], href: string): string {
  if (srcs.length === 0) return '';
  const GAP = 8;
  const size = Math.floor((EMAIL_CONTENT_WIDTH - GAP * (srcs.length - 1)) / srcs.length);
  const cells = srcs
    .map(
      (src, index) =>
        `<td width="${size}" style="padding:0 ${index === srcs.length - 1 ? 0 : GAP}px 0 0;vertical-align:top;"><a href="${escapeHtml(href)}" style="display:block;text-decoration:none;"><img src="${escapeHtml(src)}" alt="" width="${size}" style="display:block;width:100%;max-width:${size}px;height:auto;border:0;border-radius:8px;" /></a></td>`,
    )
    .join('');
  return cell(
    `${GAP}px ${GUTTER}px 0`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>`,
  );
}

const DARK_MODE = `
:root { color-scheme: light dark; supported-color-schemes: light dark; }
@media (prefers-color-scheme: dark) {
  .tw-canvas { background: ${C.darkCanvas} !important; }
  .tw-paper { background: ${C.darkPaper} !important; border-color: ${C.darkLine} !important; }
  .tw-ink { color: ${C.darkInk} !important; }
  .tw-body { color: ${C.darkBody} !important; }
  .tw-muted { color: ${C.darkMuted} !important; }
  .tw-link { color: ${C.darkAccentText} !important; }
  .tw-rule { border-color: ${C.darkLine} !important; }
}
@media only screen and (max-width: 480px) {
  .tw-gutter { padding-left: 22px !important; padding-right: 22px !important; }
}`;

export interface EmailDocumentArgs {
  /** `<html lang>`. Absent only for the studio's own Korean alerts. */
  locale?: string;
  /** The inbox's grey line after the subject. */
  preheader?: string;
  siteName: string;
  /** The small word opposite the wordmark, e.g. "렌더 결과". */
  kicker?: string;
  /** Blocks from this module, in reading order. */
  blocks: readonly string[];
  /** Grey lines under the card: who sent this and how to reach them. */
  footer: readonly string[];
}

export function emailDocument(args: EmailDocumentArgs): string {
  const lang = args.locale ?? 'ko';
  const preheader = args.preheader
    ? `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(args.preheader)}</div>`
    : '';
  const kicker = args.kicker
    ? `<td align="right" class="tw-muted" style="font-family:${EMAIL_FONT};font-size:12px;color:${C.muted};">${escapeHtml(args.kicker)}</td>`
    : '';
  const footer = args.footer.map(escapeHtml).join('<br />');
  return [
    `<!doctype html><html lang="${escapeHtml(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><style>${DARK_MODE}</style></head>`,
    `<body class="tw-canvas" style="margin:0;padding:0;background:${C.canvas};">`,
    preheader,
    `<table role="presentation" class="tw-canvas" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.canvas}" style="background:${C.canvas};margin:0;padding:0;"><tr><td align="center" style="padding:40px 16px;">`,
    `<!--[if mso]><table role="presentation" width="${WIDTH}" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->`,
    `<table role="presentation" class="tw-paper" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.paper}" style="max-width:${WIDTH}px;background:${C.paper};border:1px solid ${C.line};border-radius:24px;">`,
    `<tr><td class="tw-gutter" style="padding:28px ${GUTTER}px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="tw-ink" style="font-family:${EMAIL_FONT};font-size:14px;font-weight:600;letter-spacing:0.08em;color:${C.ink};">${escapeHtml(args.siteName)}</td>${kicker}</tr></table></td></tr>`,
    ...args.blocks,
    '<tr><td style="padding:32px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>',
    '</table>',
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:${WIDTH}px;"><tr><td class="tw-muted" style="padding:20px 12px 0;font-family:${EMAIL_FONT};font-size:12px;line-height:1.7;color:${C.muted};">${footer}</td></tr></table>`,
    '<!--[if mso]></td></tr></table><![endif]-->',
    '</td></tr></table></body></html>',
  ].join('');
}
