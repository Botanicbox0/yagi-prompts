import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MakerMonetizationShowcase } from '@/components/audience/maker-monetization-showcase';
import { SequenceDispatchSection } from '@/components/audience/sequence-dispatch';
import { getDictionary } from '@/lib/i18n/dictionaries';

describe('MakerMonetizationShowcase & Design System v2 personal landing', () => {
  it('renders Korean maker monetization showcase with Design System v2 tokens and safe payout notice', () => {
    const dict = getDictionary('ko');
    const html = renderToStaticMarkup(<MakerMonetizationShowcase dict={dict} locale="ko" />);

    expect(html).toContain('data-maker-monetization-showcase');
    expect(html).toContain('data-maker-showcase-cta');
    expect(html).toContain('data-maker-showcase-payout');
    expect(html).toContain('href="/creators/workspace"');
    expect(html).toContain('bg-[#FF58AE]');
    expect(html).toContain('text-[#09090B]');
    expect(html).toContain('bg-[#F4F4F5]');
    expect(html).toContain('border-[#E4E4E7]');
    expect(html).toContain('shadow-none');
    expect(html).toContain('예상 수익 적립 (출금 준비 중)');
    expect(html).toContain('웹 데스크톱');

    expect(html).not.toContain('#3875C5');
    expect(html).not.toContain('80%');
    expect(html).not.toMatch(/Hydrogen|Seedance|RECIPE V2/i);
  });

  it('renders English maker monetization showcase accurately', () => {
    const dict = getDictionary('en');
    const html = renderToStaticMarkup(<MakerMonetizationShowcase dict={dict} locale="en" />);

    expect(html).toContain('Estimated revenue accruing (payout setup pending)');
    expect(html).toContain('desktop web');
    expect(html).toContain('href="/creators/workspace"');
  });

  it('keeps SequenceDispatchSection free of legacy Cool Blue and unapproved 80% copy', () => {
    const html = renderToStaticMarkup(
      <SequenceDispatchSection
        locale="ko"
        hotVideos={[]}
        imageSeries={[]}
        cardSecondsPattern="{seconds}초"
        cardAuthorPattern="by {name}"
        cardAuthorAnonymous="작자 미상"
      />,
    );

    expect(html).toContain('data-direct-scene-door');
    expect(html).toContain('data-direct-scene-link');
    expect(html).toContain('bg-[#FF58AE]');
    expect(html).not.toContain('#3875C5');
    expect(html).not.toContain('#3063A7');
    expect(html).not.toContain('80%');
  });
});
