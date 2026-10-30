import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { formatDate, interpolate } from '@/lib/i18n/format';
import { companyLine } from '@/lib/notify/company-line';
import { buttonBlock, emailDocument, imageBlock, metaBlock, noteBlock, paragraphBlock, thumbnailsBlock, titleBlock } from '@/lib/notify/layout';
import type { RenderedEmail } from '@/lib/notify/templates';
import type { TemplateMedium } from '@/lib/prompts/schemas';

/**
 * The completion message (docs/TEMPLATES-IA.md §8) — "완성됐어요" with the 3-day link, or
 * "완성하지 못했어요" with the reason and a way back to the template.
 *
 * On the shared layout (lib/notify/layout.ts): the result image is the only large colour in the mail.
 *
 * What the message carries: the template's name, the aspect, the expiry date, the link and — for
 * an image — the result itself as a preview (a set: the first picture large, the rest as a row of
 * thumbnails, all through the same link). Never the prompt, never a storage key; the preview
 * rides the render gateway with the share token, so it dies with the link.
 */

export interface RenderEmailLinks {
  /** The 3-day capability (ready) or the owner's list (failed). */
  primaryUrl: string;
  /** Absolute preview, image renders only; films have no frame to show. */
  previewUrl: string | null;
  /** A set's other pictures (2…N), absolute, in order — shown small under the preview. */
  morePreviewUrls?: readonly string[];
  templateUrl: string;
  rendersUrl: string;
  /** The owner's result page, at the feedback form (2026-09-11): where "not happy?" goes. */
  feedbackUrl: string;
}

export interface RenderEmailInput {
  kind: 'ready' | 'failed';
  locale: Locale;
  templateTitle: string;
  medium: TemplateMedium;
  aspect: string;
  /** When the link closes — ready only. */
  expiresAt: Date | null;
  /** The localized explanation — failed only. */
  reason: string | null;
  /** How many pictures a set made (2+); absent or 1 for one result. */
  frames?: number;
  links: RenderEmailLinks;
  siteName: string;
}

export function renderResultEmail(input: RenderEmailInput): RenderedEmail {
  const dict = getDictionary(input.locale);
  const copy = dict.renders.email;
  const ready = input.kind === 'ready';
  const expires = input.expiresAt ? (formatDate(input.expiresAt.toISOString(), input.locale) ?? '') : '';
  const template = input.templateTitle.trim();

  const subject = interpolate(ready ? copy.readySubject : copy.failedSubject, { template });
  const preheader = ready ? copy.readyPreheader : copy.failedPreheader;
  const title = ready ? copy.readyTitle : copy.failedTitle;
  const body = ready
    ? interpolate(copy.readyBody, { template, date: expires })
    : interpolate(copy.failedBody, { template, reason: input.reason ?? '' }).replace(/\s{2,}/g, ' ');
  const cta = ready ? copy.readyCta : copy.failedCta;
  const ctaUrl = ready ? input.links.primaryUrl : input.links.templateUrl;
  const kind = input.frames && input.frames > 1 ? interpolate(dict.renders.frames.count, { n: input.frames }) : dict.nav[input.medium];
  const meta = [template, kind, input.aspect].filter(Boolean).join(' · ');

  return {
    subject,
    html: html({ preheader, title, body, cta, ctaUrl, meta, ready, copy, links: input.links, siteName: input.siteName, locale: input.locale }),
    text: text({ title, body, cta, ctaUrl, meta, copy, links: input.links, siteName: input.siteName, locale: input.locale }),
  };
}

interface Parts {
  title: string;
  body: string;
  cta: string;
  ctaUrl: string;
  meta: string;
  copy: ReturnType<typeof getDictionary>['renders']['email'];
  links: RenderEmailLinks;
  siteName: string;
  locale: Locale;
}

function html(parts: Parts & { preheader: string; ready: boolean }): string {
  const { preheader, title, body, cta, ctaUrl, meta, ready, copy, links, siteName, locale } = parts;
  return emailDocument({
    locale,
    preheader,
    siteName,
    kicker: copy.kicker,
    blocks: [
      ...(ready && links.previewUrl
        ? [imageBlock(links.previewUrl, links.primaryUrl), thumbnailsBlock(links.morePreviewUrls ?? [], links.primaryUrl)]
        : []),
      titleBlock(title),
      paragraphBlock(body),
      metaBlock(meta),
      buttonBlock(cta, ctaUrl),
      noteBlock(copy.keepLine, { label: copy.myRenders, url: links.rendersUrl }),
      noteBlock(copy.feedbackLine, { label: copy.feedbackCta, url: links.feedbackUrl }, 12),
    ],
    footer: [copy.footer, companyLine(locale, { address: true })],
  });
}

function text(parts: Parts): string {
  const { title, body, cta, ctaUrl, meta, copy, links, siteName, locale } = parts;
  return [
    `${siteName} — ${copy.kicker}`,
    '',
    title,
    '',
    body,
    '',
    meta,
    '',
    `${cta}: ${ctaUrl}`,
    '',
    `${copy.keepLine} ${copy.myRenders}: ${links.rendersUrl}`,
    `${copy.feedbackLine} ${copy.feedbackCta}: ${links.feedbackUrl}`,
    '',
    '—',
    copy.footer,
    companyLine(locale, { address: true }),
  ].join('\n');
}
