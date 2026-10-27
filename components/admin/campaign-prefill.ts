import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { loadStudioProject } from '@/lib/brands/workspace/service';
import { campaignPrefillFromTerms, type CampaignPrefill, type CampaignTerms } from '@/lib/brands/workspace/campaign-terms';

/**
 * The Korean brief lines a wizard request adds to the admin form: what the structured campaign fields
 * cannot hold (conditions, a brand-only format note, what creators must not do). Korean, because the
 * brand wrote in Korean; TWINGS writes the English side.
 */
export function campaignBriefLines(terms: CampaignTerms): string[] {
  const t = getDictionary('ko').brandWorkspace.wizard;
  const lines: string[] = [];
  if (terms.format.kind === 'custom') lines.push(`${t.format.custom}: ${terms.format.note}`);
  const a = terms.audience;
  if (a.mode === 'invited') lines.push(`${t.steps.audience}: ${t.audience.modes.invited}`);
  if (a.mode === 'criteria') {
    if (a.minFollowers !== null) lines.push(`${t.audience.minFollowers}: ${a.minFollowers.toLocaleString('ko-KR')}`);
    if (a.gender !== 'any') lines.push(`${t.audience.gender}: ${t.audience.genders[a.gender]}`);
    if (a.regions.length) lines.push(`${t.audience.regions}: ${a.regions.join(', ')}`);
  }
  if (terms.schedule.prohibited) lines.push(`${t.schedule.prohibited}: ${terms.schedule.prohibited}`);
  return lines;
}

/** The "new campaign" form's starting values for `?project=<id>`, or null when there is nothing to copy. */
export async function loadCampaignPrefill(sql: SqlRunner, viewer: Viewer, projectId: string | undefined): Promise<{ prefill: CampaignPrefill; projectId: string; projectTitle: string } | null> {
  if (!projectId) return null;
  const p = await loadStudioProject({ sql }, viewer, projectId).catch(() => null);
  if (!p?.campaignTerms) return null;
  return {
    projectId: p.id,
    projectTitle: p.title,
    prefill: campaignPrefillFromTerms({ title: p.title, objective: p.objective, organizationName: p.organizationName }, p.campaignTerms, campaignBriefLines),
  };
}
