import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { PhotoCheckView } from '@/components/identity/photo-check-note';
import { SelfieSheet } from '@/components/identity/selfie-sheet';
import { PHOTO_CHECK_ISSUES } from '@/lib/identity/photo-check-view';
import type { SelfieView } from '@/lib/identity/selfie-service';

/** The advisory photo check on screen: our words, neutral ink, and never a disabled button. */
const ID = '10000000-0000-4000-8000-000000000001';
const face: SelfieView = { id: ID, width: 320, height: 400, createdAt: '2026-11-15T00:00:00.000Z', imageUrl: `/api/identity/selfie/${ID}/image`, label: null, isDefault: true, lastUsedAt: null };
const noop = () => {};

describe('photo check advice', () => {
  for (const locale of ['ko', 'en'] as const) {
    const copy = getDictionary(locale).selfie;

    it(`has a line for every issue, without internal names (${locale})`, () => {
      for (const code of PHOTO_CHECK_ISSUES) expect(copy.photoCheck.issues[code]).toBeTruthy();
      const all = JSON.stringify(copy.photoCheck);
      expect(all).not.toMatch(/gemini|google|\bAI\b|모델|판정/i);
    });

    it(`retake: up to three issue lines, the suggestion, the change action — and the make button stays enabled (${locale})`, () => {
      const check = { status: 'retake' as const, issues: ['multiple_faces', 'face_covered', 'blurry', 'dark'] as const };
      const html = renderToStaticMarkup(<SelfieSheet copy={copy} locale={locale} suggested={face} chosen={null} onChoose={noop} initialPhotoCheck={{ ...check, issues: [...check.issues] }} />);
      expect(html).toContain('data-photo-check="retake"');
      expect(html.match(/data-photo-check-issue=/g)).toHaveLength(3);
      expect(html).toContain('data-photo-check-issue="multiple_faces"');
      expect(html).not.toContain('data-photo-check-issue="dark"');
      expect(html).toContain(copy.photoCheck.retake);
      expect(html).toMatch(new RegExp(`data-photo-check-retake[^>]*>${copy.otherPhotos}<`));
      expect(html).toMatch(/<button[^>]*data-selfie-use[^>]*>/);
      expect(html.match(/<button[^>]*data-selfie-use[^>]*>/)![0]).not.toContain('disabled');
      expect(html).not.toMatch(/disabled=""/);
      // Neutral ink: no red, no accent colour on the advice.
      const block = html.slice(html.indexOf('data-photo-check='), html.indexOf('data-selfie-use'));
      const classes = (block.match(/class="[^"]*"/g) ?? []).join(' ');
      expect(classes).not.toMatch(/red|accent|badge|rose|pink/);
    });

    it(`the chosen face carries the advice too (${locale})`, () => {
      const html = renderToStaticMarkup(<SelfieSheet copy={copy} locale={locale} suggested={face} chosen={face} onChoose={noop} initialPhotoCheck={{ status: 'check', issues: ['side_angle'] }} />);
      expect(html).toContain('data-photo-check="check"');
      expect(html).toContain(copy.photoCheck.issues.side_angle);
      expect(html).not.toContain(copy.photoCheck.retake);
      expect(html).not.toContain('data-photo-check-retake');
    });

    it(`good says one short line (${locale})`, () => {
      const html = renderToStaticMarkup(<PhotoCheckView check={{ status: 'good', issues: [] }} copy={copy.photoCheck} />);
      expect(html).toContain('data-photo-check="good"');
      expect(html).toContain(copy.photoCheck.good);
      expect(html).not.toContain('data-photo-check-issue');
    });
  }

  it('renders nothing for no result, while loading, or with the check off', () => {
    const copy = getDictionary('ko').selfie;
    expect(renderToStaticMarkup(<PhotoCheckView check={null} copy={copy.photoCheck} />)).toBe('');
    expect(renderToStaticMarkup(<PhotoCheckView check={undefined} copy={copy.photoCheck} />)).toBe('');
    for (const initialPhotoCheck of [null, undefined]) {
      const html = renderToStaticMarkup(<SelfieSheet copy={copy} locale="ko" suggested={face} chosen={null} onChoose={noop} initialPhotoCheck={initialPhotoCheck} />);
      expect(html).not.toContain('data-photo-check');
      expect(html).toContain('data-selfie-use');
    }
  });
});
