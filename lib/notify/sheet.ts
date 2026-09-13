import { escapeHtml } from './templates';

/**
 * The one transactional email sheet (2026-09-11): white card on light grey, one dark button, grey
 * meta. Brand enquiries, result feedback and the campaign mails all render through it so a change
 * of tone is one edit. The render-result mail keeps its own richer layout (preview image).
 */
export interface SheetArgs {
  title: string;
  paragraphs: string[];
  rows?: Array<[string, string]>;
  button?: { label: string; url: string } | null;
  /** A short grey line under the button — the unsubscribe sentence, or a "why you got this". */
  note?: { text: string; link?: { label: string; url: string } } | null;
  footer: string;
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Pretendard','Apple SD Gothic Neo',sans-serif";

export function sheet(args: SheetArgs): string {
  const rows = (args.rows ?? [])
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#71717a;font-size:13px;vertical-align:top;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:6px 0;font-size:14px;color:#18181b;white-space:pre-wrap">${escapeHtml(v)}</td></tr>`,
    )
    .join('');
  const button = args.button
    ? `<p style="margin:28px 0 0"><a href="${escapeHtml(args.button.url)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;border-radius:999px;padding:12px 22px;font-size:14px;font-weight:600">${escapeHtml(args.button.label)}</a></p>`
    : '';
  const note = args.note
    ? `<p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#a1a1aa">${escapeHtml(args.note.text)}${
        args.note.link ? ` <a href="${escapeHtml(args.note.link.url)}" style="color:#18181b;text-decoration:underline">${escapeHtml(args.note.link.label)}</a>` : ''
      }</p>`
    : '';
  return [
    `<!doctype html><html><body style="margin:0;padding:32px 16px;background:#f4f4f5;font-family:${FONT};color:#18181b">`,
    '<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:36px 32px">',
    `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">${escapeHtml(args.title)}</h1>`,
    ...args.paragraphs.map((p) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6">${escapeHtml(p)}</p>`),
    rows ? `<table style="border-collapse:collapse;margin-top:16px">${rows}</table>` : '',
    button,
    note,
    `<p style="margin:32px 0 0;font-size:12px;color:#a1a1aa;line-height:1.5">${escapeHtml(args.footer)}</p>`,
    '</div></body></html>',
  ].join('');
}

/** The text/plain twin of `sheet()`, in the same order. */
export function sheetText(args: SheetArgs): string {
  return [
    args.title,
    '',
    ...args.paragraphs,
    ...(args.rows && args.rows.length > 0 ? ['', ...args.rows.map(([k, v]) => `${k}: ${v}`)] : []),
    ...(args.button ? ['', `${args.button.label}: ${args.button.url}`] : []),
    ...(args.note ? ['', `${args.note.text}${args.note.link ? ` ${args.note.link.label}: ${args.note.link.url}` : ''}`] : []),
    '',
    '—',
    args.footer,
  ].join('\n');
}
