import { describe, expect, it } from 'vitest';
import { LEGAL_DOCS, legalDocument } from '@/lib/legal/documents';
import { subscriptionLegalDocument } from '@/lib/creator-subscriptions/legal-projection';
import { SUBSCRIPTION_TERMS_DRAFT } from '@/lib/creator-subscriptions/legal';
import { subscriptionTermsDigest } from '@/lib/creator-subscriptions/evidence';

describe('approved monthly legal projection', () => {
  it('leaves every existing public policy unchanged before actual content approval', () => {
    for (const locale of ['ko', 'en'] as const) for (const doc of LEGAL_DOCS)
      expect(subscriptionLegalDocument(doc, locale, false)).toBe(legalDocument(doc, locale));
  });
  it('removes conflicting single-purchase payment text while preserving own-face verification', () => {
    for (const locale of ['ko', 'en'] as const) {
      const terms = subscriptionLegalDocument('terms', locale, true).body;
      expect(terms).toContain(SUBSCRIPTION_TERMS_DRAFT[locale]);
      expect(terms).not.toMatch(/정기결제가 아닙니다|This is not a subscription/);
      expect(terms).toContain(locale === 'ko' ? '계정마다 하나뿐인 인물 자산 그룹' : 'the one likeness asset group');
    }
  });
  it('separates monthly refund rights from one-time purchase deadlines and explains OpenAI processing', () => {
    const refund = subscriptionLegalDocument('refund', 'ko', true).body;
    expect(refund).toContain('아래 1~7항은 템플릿 단건 구매');
    expect(refund).toContain('현재 결제 기간의 제작량을 사용하지 않았고');
    expect(refund).toContain('관련 법령에 따른 권리');
    const privacy = subscriptionLegalDocument('privacy', 'ko', true).body;
    expect(privacy).toContain('참고 이미지 최대 3장');
    expect(privacy).toContain('원본 제작 프롬프트와 얼굴 기준 사진은 이 요청에 포함하지 않습니다');
    expect(privacy).toContain('최대 30일');
    expect(privacy).not.toContain('즉시 삭제됩니다');
    expect(subscriptionTermsDigest()).toMatch(/^[a-f0-9]{64}$/);
  });
});
