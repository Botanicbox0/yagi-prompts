import { describe, expect, it } from 'vitest';
import { canonicalPost } from '@/lib/creator-platform/social';
import { marginSplit, rewardQuote } from '@/lib/creator-platform/economics';

describe('post identity, not arbitrary URLs', () => {
  it('deduplicates aliases and tracking without fetching them', () => {
    expect(canonicalPost('https://www.instagram.com/reels/ABC_123/?igsh=secret')).toEqual({platform:'instagram',key:'instagram:ABC_123',url:'https://www.instagram.com/reel/ABC_123/'});
    expect(canonicalPost('https://twitter.com/user/status/123456')).toEqual(canonicalPost('https://x.com/user/status/123456?x=1'));
    expect(canonicalPost('https://youtu.be/abcdefghijk?t=2')?.key).toBe('youtube:abcdefghijk');
  });
  it.each(['http://instagram.com/p/abc','https://instagram.com.evil.test/p/a','https://u:p@instagram.com/p/a','https://instagram.com:444/p/a','https://127.0.0.1/','https://vm.tiktok.com/abc','https://instagram.com/a','https://instagram.com/p/a/../b'])('rejects %s', url => expect(canonicalPost(url)).toBeNull());
});
describe('budget conservation', () => {
  it('splits margin, not sales, and never charges a creator a loss', () => {
    expect(marginSplit({revenue:10000,tax:900,fees:300,providerCost:5000,creator:true})).toEqual({margin:3800,creator:3040,platform:760});
    expect(marginSplit({revenue:100,tax:10,fees:10,providerCost:100,creator:true})).toEqual({margin:0,creator:0,platform:0});
  });
  it('budgets full image redemption and preserves the creator share', () => {
    expect(rewardQuote({platformMargin:760,costPerCredit:100,cap:20})).toEqual({credits:7,liability:700,remaining:60});
    expect(rewardQuote({platformMargin:0,costPerCredit:100,cap:20}).credits).toBe(0);
    expect(()=>rewardQuote({platformMargin:100,costPerCredit:0,cap:20})).toThrow();
    expect(()=>marginSplit({revenue:NaN,tax:0,fees:0,providerCost:0,creator:false})).toThrow();
  });
});
