import { CASE_STUDIES } from './case-studies';

/** Customer stories group campaigns; each campaign retains its own evidence and metrics. */
export const BRAND_STORIES = [{ slug: 'morphic', campaignIds: ['morphic-90s-interview', 'morphic-september-kr-jp'] }] as const;

export function brandStory(slug: string) {
  const story = BRAND_STORIES.find(item => item.slug === slug);
  if (!story) return null;
  const campaigns = story.campaignIds.map(id => {
    const campaign = CASE_STUDIES.find(item => item.id === id);
    if (!campaign) throw new Error(`Missing public campaign: ${id}`);
    return campaign;
  });
  return { ...story, campaigns };
}
