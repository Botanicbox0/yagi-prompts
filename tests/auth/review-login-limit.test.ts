import { describe, expect, it } from 'vitest';
import { allowReviewLogin } from '@/lib/auth/review-login-limit';
describe('bounded review login attempt budget', () => {
  it('limits one account across clients and expires the window', () => {
    const now = 2_000_000_000_000;
    for (let i=0; i<5; i++) expect(allowReviewLogin(`client-${i}`, 'review@example.test', now)).toBe(true);
    expect(allowReviewLogin('another-client', 'review@example.test', now)).toBe(false);
    expect(allowReviewLogin('another-client', 'review@example.test', now+60_001)).toBe(true);
  });
  it('limits a client rotating target addresses', () => {
    const now = 2_000_000_100_000;
    for (let i=0; i<10; i++) expect(allowReviewLogin('same-client', `r${i}@example.test`, now)).toBe(true);
    expect(allowReviewLogin('same-client','rotated@example.test',now)).toBe(false);
  });
});
