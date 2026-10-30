import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { brandInquiryEmails } from '@/lib/brands/email';
import { buttonBlock, EMAIL_COLOUR, emailDocument, paragraphBlock } from '@/lib/notify/layout';
import { sheet, sheetText } from '@/lib/notify/sheet';
import { renderNotificationEmail } from '@/lib/notify/templates';
import { signUnsubscribeToken } from '@/lib/notify/unsubscribe';
import { renderResultEmail } from '@/lib/renders/email';

/** docs/MEMBER-NOTIFICATIONS.md §5: every mail on one layout, in docs/design/IDENTITY.md's colours. */

const mails: Record<string, string> = {
  sheet: sheet({ title: 'T', paragraphs: ['p'], button: { label: 'B', url: 'https://x.test/a' }, footer: 'f' }),
  notification: renderNotificationEmail(
    { kind: 'new_playbook', locale: 'ko', title: { en: 'A', ko: '가' }, summary: { en: 'B', ko: '나' }, changeNote: null },
    { playbookUrl: 'https://x.test/p', unsubscribeUrl: 'https://x.test/u', accountUrl: 'https://x.test/c' },
  ).html,
  result: renderResultEmail({
    kind: 'ready',
    locale: 'ko',
    templateTitle: 'T',
    medium: 'image',
    aspect: '4:5',
    expiresAt: new Date('2026-11-03T00:00:00Z'),
    reason: null,
    siteName: 'TWINGS',
    links: { primaryUrl: 'https://x.test/r', previewUrl: 'https://x.test/i.jpg', templateUrl: 'https://x.test/t', rendersUrl: 'https://x.test/l', feedbackUrl: 'https://x.test/f' },
  }).html,
};

describe('the shared mail layout', () => {
  it.each(Object.keys(mails))('%s: the identity colours, table layout, dark mode, no retired palette', (name) => {
    const html = mails[name] as string;
    expect(html).toContain(EMAIL_COLOUR.accent);
    expect(html).toContain('role="presentation"');
    expect(html).toContain('prefers-color-scheme: dark');
    expect(html).toContain('<!--[if mso]>');
    expect(html.toLowerCase()).not.toMatch(/#0000ee|#f4f4f5|#a1a1aa|background:#111|#ed1e1e|<script/);
  });

  it('no mail module carries its own palette or document shell any more', () => {
    for (const file of ['lib/brands/email.ts', 'lib/renders/feedback.ts', 'lib/renders/email.ts', 'lib/notify/templates.ts', 'lib/notify/sheet.ts']) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/<!doctype|<table|#[0-9a-f]{6}/i);
    }
  });

  it('puts white on the accent button and escapes what it is given', () => {
    const button = buttonBlock('<b>', 'https://x.test/?a=1&b=2');
    expect(button).toContain(`bgcolor="${EMAIL_COLOUR.accent}"`);
    expect(button).toContain('color:#ffffff');
    expect(button).toContain('&lt;b&gt;');
    expect(button).toContain('a=1&amp;b=2');
    expect(paragraphBlock('<x>')).not.toContain('<x>');
  });

  it('keeps the text twin in step with the sheet', () => {
    const text = sheetText({ title: 'T', paragraphs: ['p'], button: { label: 'B', url: 'https://x.test/a' }, footer: 'f' });
    expect(text).toContain('B: https://x.test/a');
  });

  it('answers in the mail language', () => {
    expect(emailDocument({ locale: 'en', siteName: 'TWINGS', blocks: [], footer: [] })).toContain('<html lang="en">');
    const { brand } = brandInquiryEmails({
      inquiry: { id: 'i', locale: 'en', company: 'C', contactName: 'N', email: 'e@x.test', phone: null, budgetBand: 'undecided', templateSlug: null, timing: null, message: 'm' } as never,
      siteName: 'TWINGS',
      siteUrl: 'https://x.test',
      adminUrl: 'https://x.test/admin',
    });
    expect(brand.html).toContain('<html lang="en">');
    expect(brand.html).toContain(EMAIL_COLOUR.accent);
  });
});

const disable = vi.hoisted(() => vi.fn(async () => ({ ok: true, locale: 'ko' as const })));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => ({}) }));
vi.mock('@/lib/notify/preferences', () => ({ disableToggle: disable }));

describe('one-click unsubscribe', () => {
  it('honours the POST the List-Unsubscribe-Post header promises', async () => {
    process.env.NOTIFY_TOKEN_SECRET = 'test-only-secret-00000000000000000000';
    const { POST } = await import('@/app/api/notify/unsubscribe/route');
    const token = signUnsubscribeToken({ userId: 'u1', toggle: 'notif_new_playbook' });
    const response = await POST(new Request(`https://x.test/api/notify/unsubscribe?t=${encodeURIComponent(token)}`, { method: 'POST', body: 'List-Unsubscribe=One-Click' }));
    expect(response.status).toBe(200);
    expect(disable).toHaveBeenCalledWith({}, 'u1', 'notif_new_playbook');
  });
});
