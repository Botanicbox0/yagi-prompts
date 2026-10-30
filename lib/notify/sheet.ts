import { getDictionary } from '@/lib/i18n/dictionaries';
import { buttonBlock, emailDocument, noteBlock, paragraphBlock, rowsBlock, titleBlock } from './layout';

/**
 * The plain message on the shared layout (lib/notify/layout.ts): a title, a few sentences, an
 * optional list, one button. Brand enquiries, result feedback and the campaign and template mails
 * all render through it. The render-result mail composes the same blocks around its preview image.
 */
export interface SheetArgs {
  title: string;
  paragraphs: string[];
  rows?: Array<[string, string]>;
  button?: { label: string; url: string } | null;
  /** A short grey line under the button — the unsubscribe sentence, or a "why you got this". */
  note?: { text: string; link?: { label: string; url: string } } | null;
  footer: string;
  locale?: string;
}

export function sheet(args: SheetArgs): string {
  return emailDocument({
    locale: args.locale,
    siteName: getDictionary(args.locale === 'en' ? 'en' : 'ko').meta.siteName,
    blocks: [
      titleBlock(args.title),
      ...args.paragraphs.map(paragraphBlock),
      rowsBlock(args.rows ?? []),
      args.button ? buttonBlock(args.button.label, args.button.url) : '',
      args.note ? noteBlock(args.note.text, args.note.link) : '',
    ],
    footer: [args.footer],
  });
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
