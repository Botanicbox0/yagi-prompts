/**
 * Writes the mail layouts to a folder as .html, to look at in a browser. Sends nothing.
 *   npx tsx scripts/email-preview.ts <out-dir>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brandInquiryEmails } from '@/lib/brands/email';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { sheet } from '@/lib/notify/sheet';
import { renderNotificationEmail } from '@/lib/notify/templates';
import { renderResultEmail } from '@/lib/renders/email';

const out = process.argv[2];
if (!out) throw new Error('usage: email-preview <out-dir>');
mkdirSync(out, { recursive: true });

const SITE = 'https://twings.app';
const PICTURE = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="456" height="570"><rect width="456" height="570" fill="#d0dbe7"/><rect y="400" width="456" height="170" fill="#b4c3d7"/></svg>')}`;
const links = { primaryUrl: `${SITE}/r/x`, previewUrl: PICTURE, templateUrl: `${SITE}/ko/video/x`, rendersUrl: `${SITE}/renders`, feedbackUrl: `${SITE}/renders/x` };
const result = { locale: 'ko', templateTitle: '웨딩 화보', medium: 'image', aspect: '4:5', siteName: 'TWINGS' } as const;
const announce = getDictionary('ko').templates.announce;

const mails: Record<string, string> = {
  'result-ready': renderResultEmail({ ...result, kind: 'ready', expiresAt: new Date('2026-11-03T00:00:00Z'), reason: null, links }).html,
  'result-failed': renderResultEmail({ ...result, kind: 'failed', expiresAt: null, reason: '콘텐츠 정책에 걸렸습니다.', links }).html,
  'template-announce': sheet({
    locale: 'ko',
    title: announce.title,
    paragraphs: ['웨딩 화보 · 이미지 · 예시 가격. 사진 한 장으로 이 장면의 주인공이 되어 보세요.'],
    button: { label: announce.cta, url: `${SITE}/ko/video/x` },
    note: { text: announce.unsubscribeLine, link: { label: announce.unsubscribeCta, url: `${SITE}/api/notify/unsubscribe` } },
    footer: announce.footer,
  }),
  'playbook-new': renderNotificationEmail(
    { kind: 'new_playbook', locale: 'ko', title: { en: 'Wedding set', ko: '웨딩 화보' }, summary: { en: '', ko: '사진 한 장으로 만드는 웨딩 화보입니다.' }, changeNote: null },
    { playbookUrl: `${SITE}/ko/video/x`, unsubscribeUrl: `${SITE}/u`, accountUrl: `${SITE}/account` },
  ).html,
  'brand-receipt': brandInquiryEmails({
    inquiry: { id: 'example', locale: 'ko', company: '예시 회사', contactName: '예시 담당자', email: 'contact@example.com', phone: null, budgetBand: 'undecided', templateSlug: null, timing: null, message: '예시 문의입니다.' } as never,
    siteName: 'TWINGS',
    siteUrl: SITE,
    adminUrl: `${SITE}/admin`,
  }).brand.html,
};

for (const [name, html] of Object.entries(mails)) writeFileSync(join(out, `${name}.html`), html);
console.log(Object.keys(mails).join('\n'));
