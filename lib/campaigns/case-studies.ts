import { z } from 'zod';

const FilmsMetric = z.object({
  id: z.literal('films'),
  value: z.literal(9),
  relation: z.literal('exact'),
}).strict();

const ViewsMetric = z.object({
  id: z.literal('views'),
  value: z.literal(2_000_000),
  relation: z.literal('at_least'),
}).strict();

const OrganicMetric = z.object({
  id: z.literal('organic'),
  value: z.literal(300),
  relation: z.literal('at_least'),
}).strict();

export const CaseMetric = z.discriminatedUnion('id', [FilmsMetric, ViewsMetric, OrganicMetric]);

const mediaFile = <T extends 'september-01' | 'september-02'>(id: T) => z.object({
  id: z.literal(id),
  src: z.literal(`/reel/brands/morphic-${id}.mp4` as const),
  poster: z.literal(`/reel/brands/morphic-${id}.jpg` as const),
  width: z.literal(960),
  height: z.literal(720),
}).strict();

export const CaseMedia = z.discriminatedUnion('id', [mediaFile('september-01'), mediaFile('september-02')]);

const augustFilm = (id: 'august-01' | 'august-02', post: string) => z.object({
  id: z.literal(id), src: z.literal(`/reel/brands/morphic-${id}.mp4`),
  poster: z.literal(`/reel/brands/morphic-${id}.jpg`), width: z.literal(720), height: z.literal(1280), postUrl: z.literal(post),
}).strict();

const campaignPost = <Id extends string, Market extends 'KR' | 'JP'>(id: Id, market: Market, url: string) => z.object({
  id: z.literal(id), market: z.literal(market), url: z.literal(url),
}).strict();

const Morphic90sCase = z.object({
  id: z.literal('morphic-90s-interview'),
  copyKey: z.literal('morphic90s'),
  period: z.literal('2026-08'),
  metrics: z.tuple([FilmsMetric, ViewsMetric, OrganicMetric]),
  media: z.tuple([augustFilm('august-01', 'https://www.instagram.com/p/DcXjygPg8fE/'), augustFilm('august-02', 'https://www.instagram.com/p/DcShoikJklw/')]),
  evidence: z.string().min(1),
  sourceUrl: z.literal('https://morphic.com/en/workflows/019feecc-c7ec-77bd-bc3a-2ddc1f680105/90s-korean-street-interview'),
}).strict();

const MorphicSeptemberCase = z.object({
  id: z.literal('morphic-september-kr-jp'),
  copyKey: z.literal('morphicSeptember'),
  period: z.literal('2026-09'),
  metrics: z.tuple([]),
  media: z.tuple([mediaFile('september-01'), mediaFile('september-02')]),
  posts: z.tuple([
    campaignPost('kr01', 'KR', 'https://www.instagram.com/p/DdqhUUvRUik/'),
    campaignPost('kr02', 'KR', 'https://www.instagram.com/p/DdqirU_yjr-/'),
    campaignPost('jp01', 'JP', 'https://www.instagram.com/p/Dd1CiCDSlix/'),
    campaignPost('jp02', 'JP', 'https://www.instagram.com/p/Dd0VQJaz8h-/'),
  ]),
  evidence: z.string().min(1),
  sourceUrl: z.null(),
}).strict();

/**
 * Public evidence approved by the founder on 2026-10-08.
 *
 * The discriminated records make it impossible to attribute the August aggregate figures to the
 * September follow-up. The visible page renders values from these records rather than duplicating
 * them in the translation dictionaries.
 */
export const CaseStudy = z.discriminatedUnion('id', [Morphic90sCase, MorphicSeptemberCase]);

export type CampaignCaseStudy = z.infer<typeof CaseStudy>;
export type CampaignCaseMetric = z.infer<typeof CaseMetric>;

export function formatCampaignMetric(metric: CampaignCaseMetric, locale: 'ko' | 'en'): string {
  const lowerBound = metric.relation === 'at_least' ? '+' : '';
  if (metric.id === 'films') return locale === 'ko' ? `${metric.value}편` : `${metric.value}`;
  if (metric.id === 'views') {
    return locale === 'ko'
      ? `${metric.value / 10_000}만${lowerBound}`
      : `${metric.value / 1_000_000}M${lowerBound}`;
  }
  return locale === 'ko' ? `${metric.value}건${lowerBound}` : `${metric.value}${lowerBound}`;
}

export const CASE_STUDIES: readonly CampaignCaseStudy[] = z.array(CaseStudy).parse([
  {
    id: 'morphic-90s-interview',
    copyKey: 'morphic90s',
    period: '2026-08',
    metrics: [
      { id: 'films', value: 9, relation: 'exact' },
      { id: 'views', value: 2_000_000, relation: 'at_least' },
      { id: 'organic', value: 300, relation: 'at_least' },
    ],
    media: [
      { id: 'august-01', src: '/reel/brands/morphic-august-01.mp4', poster: '/reel/brands/morphic-august-01.jpg', width: 720, height: 1280, postUrl: 'https://www.instagram.com/p/DcXjygPg8fE/' },
      { id: 'august-02', src: '/reel/brands/morphic-august-02.mp4', poster: '/reel/brands/morphic-august-02.jpg', width: 720, height: 1280, postUrl: 'https://www.instagram.com/p/DcShoikJklw/' },
    ],
    evidence: 'Founder-approved public aggregate: 9 films, 2M+ views, 300+ derivative organic posts.',
    sourceUrl: 'https://morphic.com/en/workflows/019feecc-c7ec-77bd-bc3a-2ddc1f680105/90s-korean-street-interview',
  },
  {
    id: 'morphic-september-kr-jp',
    copyKey: 'morphicSeptember',
    period: '2026-09',
    metrics: [],
    media: [
      { id: 'september-01', src: '/reel/brands/morphic-september-01.mp4', poster: '/reel/brands/morphic-september-01.jpg', width: 960, height: 720 },
      { id: 'september-02', src: '/reel/brands/morphic-september-02.mp4', poster: '/reel/brands/morphic-september-02.jpg', width: 960, height: 720 },
    ],
    // Published posts verified in the brand workspace and the D2 Pitch deck on 2026-10-12.
    // They are campaign evidence, not asserted to be the two studio preview films above.
    posts: [
      { id: 'kr01', market: 'KR', url: 'https://www.instagram.com/p/DdqhUUvRUik/' },
      { id: 'kr02', market: 'KR', url: 'https://www.instagram.com/p/DdqirU_yjr-/' },
      { id: 'jp01', market: 'JP', url: 'https://www.instagram.com/p/Dd1CiCDSlix/' },
      { id: 'jp02', market: 'JP', url: 'https://www.instagram.com/p/Dd0VQJaz8h-/' },
    ],
    evidence: 'Campaign films exported 2026-09-24 with visible Morphic marks; no public performance figure attached.',
    sourceUrl: null,
  },
]);
