import { describe, expect, it } from 'vitest';
import { renderNotificationEmail } from '@/lib/notify/templates';
import { FIXTURE_SENTINELS } from '@/scripts/fixtures';

/**
 * PLAN §3.5 — the two emails, bilingual by `profiles.locale`.
 *
 * The last test is the one that carries weight: an email may contain the playbook's *card
 * metadata* and nothing else. The fixture SENTINELS are unique tokens embedded in gated block
 * content (M2's `npm run sweep:anon` uses the same oracle over HTML), so asserting that none of
 * them can appear in a rendered email checks the real property rather than a proxy for it.
 */

const LINKS = {
  playbookUrl: 'https://playbook.test/en/p/character-sheet-generation',
  unsubscribeUrl: 'https://playbook.test/api/notify/unsubscribe?t=abc.def',
  accountUrl: 'https://playbook.test/account',
};

const CONTENT = {
  title: { en: 'Character sheet generation', ko: '캐릭터 시트 제작' },
  summary: { en: 'One face, many poses.', ko: '한 얼굴, 여러 포즈.' },
  changeNote: { en: 'Swapped to Seedance 2.0', ko: 'Seedance 2.0으로 교체' },
};

describe('notification email templates (§3.5)', () => {
  it('writes the new-playbook email in the reader’s own language', () => {
    const en = renderNotificationEmail({ kind: 'new_playbook', locale: 'en', ...CONTENT }, LINKS);
    const ko = renderNotificationEmail({ kind: 'new_playbook', locale: 'ko', ...CONTENT }, LINKS);

    expect(en.subject).toContain('Character sheet generation');
    expect(en.html).toContain('Character sheet generation');
    expect(en.html).toContain('One face, many poses.');
    expect(en.html).not.toContain('캐릭터 시트 제작');

    expect(ko.subject).toContain('캐릭터 시트 제작');
    expect(ko.html).toContain('한 얼굴, 여러 포즈.');
    expect(ko.html).not.toContain('One face, many poses.');
    expect(ko.subject).not.toBe(en.subject);
  });

  it('carries the change note on an update and nothing like it on a first publication', () => {
    const update = renderNotificationEmail(
      { kind: 'playbook_update', locale: 'en', ...CONTENT },
      LINKS,
    );
    expect(update.html).toContain('Swapped to Seedance 2.0');
    expect(update.text).toContain('Swapped to Seedance 2.0');
    expect(update.subject).not.toBe(
      renderNotificationEmail({ kind: 'new_playbook', locale: 'en', ...CONTENT }, LINKS).subject,
    );

    // A change note attached to a *new* playbook is not the reader's business — the kind decides.
    const fresh = renderNotificationEmail(
      { kind: 'new_playbook', locale: 'en', ...CONTENT },
      LINKS,
    );
    expect(fresh.html).not.toContain('Swapped to Seedance 2.0');
  });

  it('survives a missing change note on an update rather than printing "null"', () => {
    const rendered = renderNotificationEmail(
      { kind: 'playbook_update', locale: 'ko', ...CONTENT, changeNote: null },
      LINKS,
    );
    expect(rendered.html).not.toContain('null');
    expect(rendered.html).not.toContain('undefined');
    expect(rendered.html).toContain('캐릭터 시트 제작');
  });

  it('always offers one-click unsubscribe, in both parts', () => {
    for (const kind of ['new_playbook', 'playbook_update'] as const) {
      for (const locale of ['en', 'ko'] as const) {
        const rendered = renderNotificationEmail({ kind, locale, ...CONTENT }, LINKS);
        expect(rendered.html, `${kind}/${locale}`).toContain(LINKS.unsubscribeUrl);
        expect(rendered.text, `${kind}/${locale}`).toContain(LINKS.unsubscribeUrl);
        expect(rendered.html, `${kind}/${locale}`).toContain(LINKS.playbookUrl);
      }
    }
  });

  it('escapes author-supplied text instead of letting it become markup', () => {
    const rendered = renderNotificationEmail(
      {
        kind: 'new_playbook',
        locale: 'en',
        title: { en: '<script>alert(1)</script>', ko: 'ko' },
        summary: { en: 'a & b "quoted"', ko: 'ko' },
        changeNote: null,
      },
      LINKS,
    );
    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).toContain('&lt;script&gt;');
    expect(rendered.html).toContain('a &amp; b');
  });

  /** §3.5 + §3.4: gated bytes must not leave the gate, and an inbox is forwardable. */
  it('cannot carry gated content — there is no parameter through which a block could arrive', () => {
    const rendered = renderNotificationEmail(
      { kind: 'playbook_update', locale: 'en', ...CONTENT },
      LINKS,
    );
    const gated = FIXTURE_SENTINELS.filter((sentinel) => sentinel.visibility !== 'public');
    expect(gated.length).toBeGreaterThan(10);
    for (const sentinel of gated) {
      expect(rendered.html, sentinel.token).not.toContain(sentinel.token);
      expect(rendered.text, sentinel.token).not.toContain(sentinel.token);
    }
    // Nor any storage addressing.
    for (const needle of ['content/rev/', 'content-published', 'artifacts-published', '/api/media/']) {
      expect(rendered.html, needle).not.toContain(needle);
    }
  });
});
