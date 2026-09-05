'use server';

import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { revalidateCampaigns } from '@/lib/cache';
import { reportCampaignViews, submitCampaignPost } from '@/lib/campaigns/service';
import { MY_CAMPAIGNS_PATH } from '@/lib/campaigns/links';
import { str } from '@/lib/admin/form';

/** The creator's post link — the id is theirs to name, the service checks it is theirs to move. */
export async function submitPostAction(form: FormData): Promise<void> {
  const viewer = await getViewer();
  const sql = await getSqlRunner();
  let outcome = 'err=invalid';
  if (viewer.userId !== null && sql !== null) {
    const result = await submitCampaignPost({ sql }, viewer, str(form, 'id'), { postUrl: str(form, 'postUrl') });
    outcome = result.ok ? 'ok=posted' : `err=${result.code}`;
    if (result.ok) revalidateCampaigns();
  } else if (viewer.userId === null) {
    outcome = 'err=sign_in_required';
  }
  redirect(`${MY_CAMPAIGNS_PATH}?${outcome}#${str(form, 'id')}`);
}

/** The seven-day view count (v1: self-reported; the admin confirms it before paying). */
export async function reportViewsAction(form: FormData): Promise<void> {
  const viewer = await getViewer();
  const sql = await getSqlRunner();
  let outcome = 'err=invalid';
  if (viewer.userId !== null && sql !== null) {
    const result = await reportCampaignViews({ sql }, viewer, str(form, 'id'), { views: str(form, 'views') });
    outcome = result.ok ? 'ok=views' : `err=${result.code}`;
  } else if (viewer.userId === null) {
    outcome = 'err=sign_in_required';
  }
  redirect(`${MY_CAMPAIGNS_PATH}?${outcome}#${str(form, 'id')}`);
}
