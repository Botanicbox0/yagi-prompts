'use server';

import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { revalidateCampaigns } from '@/lib/cache';
import { applyToCampaign } from '@/lib/campaigns/service';
import { campaignApplyPath } from '@/lib/campaigns/links';
import { bool, str, text } from '@/lib/admin/form';

/**
 * The ONE apply action (docs/CAMPAIGNS.md §6) — the same shape as the contest entry action: a thin
 * `'use server'` wrapper that resolves the viewer and the database and hands them to the service
 * that owns every decision. The slug comes from the URL, never from a form field.
 */
export async function applyAction(form: FormData): Promise<void> {
  const slug = str(form, 'slug');
  const outcome = await run(slug, form);
  redirect(`${campaignApplyPath(slug)}?${outcome}`);
}

async function run(slug: string, form: FormData): Promise<string> {
  const viewer = await getViewer();
  if (viewer.userId === null) return 'err=sign_in_required';
  const sql = await getSqlRunner();
  if (sql === null) return 'err=invalid&detail=no+database+configured';

  const result = await applyToCampaign({ sql }, viewer, slug, {
    pitch: text(form, 'pitch'),
    snsUrl: str(form, 'snsUrl'),
    followerCount: str(form, 'followerCount'),
    consent: bool(form, 'consent'),
    rememberSns: bool(form, 'rememberSns'),
  });
  if (!result.ok) {
    const detail = 'detail' in result && result.detail ? `&detail=${encodeURIComponent(String(result.detail))}` : '';
    const field = 'field' in result && result.field ? `&field=${result.field}` : '';
    return `err=${result.code}${detail}${field}`;
  }
  // An application does not change the public page, but the card's slot counter is cached.
  revalidateCampaigns();
  return `ok=1&resubmitted=${result.resubmitted ? '1' : '0'}`;
}
