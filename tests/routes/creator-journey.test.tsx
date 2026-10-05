import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CreatorJourney } from '@/components/landing/creator-journey';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { creatorCampaignsHref } from '@/lib/campaigns/links';

describe('creator discovery', () => {
  it('keeps participation discoverable even without a recruiting campaign', () => {
    for (const locale of ['ko', 'en'] as const) {
      const dict = getDictionary(locale);
      const html = renderToStaticMarkup(<CreatorJourney dict={dict} locale={locale} />);
      expect(html).toContain(creatorCampaignsHref(locale));
      expect(html).toContain(`href="/yagi/${locale}"`);
      expect(html).toContain(dict.creatorJourney.steps.face.body);
      expect(html).toContain(dict.creatorJourney.campaignBody);
      expect(html).toContain('data-creator-journey');
    }
  });
});
