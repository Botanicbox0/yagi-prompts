import { z } from 'zod';

/** Only founder-approved public evidence. No invented client names, quotes, or media attribution. */
export const CaseStudy = z.object({
  id: z.literal('global-ai-platform-launch'),
  clientKey: z.literal('caseClient'),
  goalKey: z.literal('caseGoal'),
  formatKey: z.literal('caseFormat'),
  films: z.literal(9),
  viewsAtLeast: z.literal(2_000_000),
  organicAtLeast: z.literal(300),
  evidence: z.literal('AGENTS.md §5; docs/CAMPAIGNS.md §13'),
}).strict();

export const CASE_STUDIES = [CaseStudy.parse({ id: 'global-ai-platform-launch', clientKey: 'caseClient', goalKey: 'caseGoal', formatKey: 'caseFormat', films: 9, viewsAtLeast: 2_000_000, organicAtLeast: 300, evidence: 'AGENTS.md §5; docs/CAMPAIGNS.md §13' })] as const;
