import { describe, expect, it } from 'vitest';
import { BrandInquiryInput } from '@/lib/brands/schemas';

const input = { company: 'Example', contactName: '담당자', contactRole: '마케팅 팀장', email: 'brand@example.test', budgetBand: 'undecided', message: '신제품 캠페인을 만들고 싶습니다.', consent: true, locale: 'ko' };

describe('the short enquiry preserves professional role without a database migration', () => {
  it('records the optional role in the stored enquiry message for JSON and native form posts', () => {
    expect(BrandInquiryInput.parse(input).message).toBe('직위: 마케팅 팀장\n\n신제품 캠페인을 만들고 싶습니다.');
    expect(BrandInquiryInput.parse({ ...input, locale: 'en' }).message).toBe('Role: 마케팅 팀장\n\n신제품 캠페인을 만들고 싶습니다.');
  });
  it('keeps old clients unchanged and bounds the extra field independently', () => {
    expect(BrandInquiryInput.parse({ ...input, contactRole: '' }).message).toBe(input.message);
    expect(BrandInquiryInput.safeParse({ ...input, contactRole: 'x'.repeat(81) }).success).toBe(false);
    expect(BrandInquiryInput.safeParse({ ...input, message: 'hi' }).success).toBe(false);
    expect(BrandInquiryInput.safeParse({ ...input, message: 'x'.repeat(4000) }).success).toBe(false);
  });
});
