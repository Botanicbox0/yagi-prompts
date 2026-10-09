import { describe, expect, it } from 'vitest';
import { inquiryDestination, inquirySelections } from '@/lib/campaigns/inquiry-navigation';

describe('brand enquiry navigation', () => {
  const current = 'https://twings.app/ko/brands';

  it('opens a same-page incoming link with its selected service and use case', () => {
    const destination = inquiryDestination('/ko/brands?type=production&useCase=launch#brands', current);
    expect(destination).not.toBeNull();
    expect(inquirySelections(destination!, ['campaign', 'production'], ['undecided', 'launch']))
      .toEqual({ type: 'production', useCase: 'launch' });
  });

  it('leaves cross-page, external and other section links to native navigation', () => {
    expect(inquiryDestination('/en/brands#brands', current)).toBeNull();
    expect(inquiryDestination('https://example.com/ko/brands#brands', current)).toBeNull();
    expect(inquiryDestination('/ko/brands#work', current)).toBeNull();
    expect(inquiryDestination('javascript:alert(1)', current)).toBeNull();
  });

  it('uses the form defaults for unknown query values', () => {
    const destination = new URL('/ko/brands?type=unknown&useCase=unknown#brands', current);
    expect(inquirySelections(destination, ['campaign', 'production'], ['undecided', 'launch']))
      .toEqual({ type: 'campaign', useCase: 'undecided' });
  });
});
