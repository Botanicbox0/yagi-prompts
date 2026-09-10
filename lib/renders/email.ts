import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { formatDate, interpolate } from '@/lib/i18n/format';
import { BUSINESS } from '@/lib/legal/documents';
import { escapeHtml, type RenderedEmail } from '@/lib/notify/templates';
import type { TemplateMedium } from '@/lib/prompts/schemas';

/**
 * The completion message (docs/TEMPLATES-IA.md §8) — "완성됐어요" with the 3-day link, or
 * "완성하지 못했어요" with the reason and a way back to the template.
 *
 * Design reference (founder, 2026-09-06): sume.com — a white sheet on a pale grey ground, one
 * black pill button, quiet grey metadata, generous air, no decoration. Rendered as inline-styled
 * tables because that is the subset of CSS a mail client honours; the palette is Sume's greys
 * (#111 ink, #52525b body, #a1a1aa footnote, #e4e4e7 hairline) rather than the site's accent, on
 * purpose: an inbox is a neutral place and the result image is the only colour that matters.
 *
 * What the message carries: the template's name, the aspect, the expiry date, the link and — for
 * an image — the result itself as a preview. Never the prompt, never a storage key; the preview
 * rides the render gateway with the share token, so it dies with the link.
 */

export interface RenderEmailLinks {
  /** The 3-day capability (ready) or the owner's list (failed). */
  primaryUrl: string;
  /** Absolute preview, image renders only; films have no frame to show. */
  previewUrl: string | null;
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
  links: RenderEmailLinks;
  siteName: string;
}

const PAGE = '#f4f4f5';
const SHEET = '#ffffff';
const INK = '#111111';
const BODY = '#52525b';
const FOOTNOTE = '#a1a1aa';
const HAIRLINE = '#e4e4e7';

const FONT =
  "'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Apple SD Gothic Neo', 'Malgun Gothic', Roboto, Helvetica, Arial, sans-serif";

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
  const meta = [template, dict.nav[input.medium], input.aspect].filter(Boolean).join(' · ');

  return {
    subject,
    html: html({ preheader, title, body, cta, ctaUrl, meta, ready, copy, links: input.links, siteName: input.siteName }),
    text: text({ title, body, cta, ctaUrl, meta, copy, links: input.links, siteName: input.siteName }),
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
}

function html(parts: Parts & { preheader: string; ready: boolean }): string {
  const { preheader, title, body, cta, ctaUrl, meta, ready, copy, links, siteName } = parts;
  const preview =
    ready && links.previewUrl
      ? `
      <tr><td style="padding:24px 32px 0 32px;">
        <a href="${escapeHtml(links.primaryUrl)}" style="display:block;text-decoration:none;">
          <img src="${escapeHtml(links.previewUrl)}" alt="" width="456" style="display:block;width:100%;max-width:456px;height:auto;border-radius:14px;border:1px solid ${HAIRLINE};" />
        </a>
      </td></tr>`
      : '';

  return `<!-- ${escapeHtml(preheader)} -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE};margin:0;padding:0;">
  <tr><td align="center" style="padding:40px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:${SHEET};border:1px solid ${HAIRLINE};border-radius:20px;">
      <tr><td style="padding:28px 32px 0 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="font-family:${FONT};font-size:14px;font-weight:800;letter-spacing:0.08em;color:${INK};">${escapeHtml(siteName)}</td>
            <td align="right" style="font-family:${FONT};font-size:12px;color:${FOOTNOTE};">${escapeHtml(copy.kicker)}</td>
          </tr>
        </table>
      </td></tr>
${preview}
      <tr><td style="padding:28px 32px 0 32px;">
        <h1 style="margin:0;font-family:${FONT};font-size:26px;line-height:1.25;font-weight:800;letter-spacing:-0.01em;color:${INK};">${escapeHtml(title)}</h1>
      </td></tr>
      <tr><td style="padding:12px 32px 0 32px;">
        <p style="margin:0;font-family:${FONT};font-size:15px;line-height:1.65;color:${BODY};">${escapeHtml(body)}</p>
      </td></tr>
      <tr><td style="padding:16px 32px 0 32px;">
        <p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.6;color:${FOOTNOTE};">${escapeHtml(meta)}</p>
      </td></tr>
      <tr><td style="padding:28px 32px 0 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="background:${INK};border-radius:999px;">
            <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:15px;font-weight:600;color:${SHEET};text-decoration:none;border-radius:999px;">${escapeHtml(cta)} &nearr;</a>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:24px 32px 32px 32px;">
        <p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.6;color:${FOOTNOTE};">
          ${escapeHtml(copy.keepLine)}
          <a href="${escapeHtml(links.rendersUrl)}" style="color:${INK};text-decoration:underline;">${escapeHtml(copy.myRenders)}</a>
        </p>
        <p style="margin:12px 0 0;font-family:${FONT};font-size:13px;line-height:1.6;color:${FOOTNOTE};">
          ${escapeHtml(copy.feedbackLine)}
          <a href="${escapeHtml(links.feedbackUrl)}" style="color:${INK};text-decoration:underline;">${escapeHtml(copy.feedbackCta)}</a>
        </p>
      </td></tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
      <tr><td style="padding:24px 12px 0 12px;font-family:${FONT};font-size:12px;line-height:1.7;color:${FOOTNOTE};">
        ${escapeHtml(copy.footer)}<br />
        ${escapeHtml(BUSINESS.nameKo)} · ${escapeHtml(BUSINESS.address)} · ${escapeHtml(BUSINESS.email)}
      </td></tr>
    </table>
  </td></tr>
</table>`;
}

function text(parts: Parts): string {
  const { title, body, cta, ctaUrl, meta, copy, links, siteName } = parts;
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
    `${BUSINESS.nameKo} · ${BUSINESS.address} · ${BUSINESS.email}`,
  ].join('\n');
}
