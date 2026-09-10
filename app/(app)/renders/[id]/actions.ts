'use server';

import { after } from 'next/server';
import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getMailer } from '@/lib/notify/service';
import { siteUrl } from '@/lib/seo/site-url';
import { notifyRenderFeedback, submitRenderFeedback } from '@/lib/renders/feedback';
import { renderHref } from '@/lib/renders/share';
import { str, text } from '@/lib/admin/form';

/**
 * The result page's one form (2026-09-11): "not happy with the result?". A thin wrapper — the
 * service checks ownership and validity; the studio's alert goes out after the redirect.
 */
export async function submitFeedbackAction(form: FormData): Promise<void> {
  const renderId = str(form, 'renderId');
  const outcome = await run(renderId, form);
  redirect(`${renderHref(renderId)}?feedback=${outcome}#feedback`);
}

async function run(renderId: string, form: FormData): Promise<'sent' | 'invalid' | 'not_found' | 'sign_in_required' | 'unavailable'> {
  const viewer = await getViewer();
  const sql = await getSqlRunner();
  if (sql === null) return 'unavailable';
  const result = await submitRenderFeedback({ sql }, viewer, renderId, { reason: str(form, 'reason'), message: text(form, 'message') });
  if (!result.ok) return result.code;

  const { feedback, templateTitle } = result;
  const email = viewer.email;
  after(async () => {
    try {
      const outcome = await notifyRenderFeedback(
        { mailer: getMailer(), siteUrl: siteUrl(), siteName: getDictionary('ko').meta.siteName },
        feedback,
        { templateTitle, email },
      );
      console.info(`[renders] feedback ${feedback.id} mail ${outcome?.ok ?? 'skipped'}`);
    } catch (error) {
      console.error(`[renders] feedback mail ${feedback.id} failed`, error);
    }
  });
  return 'sent';
}
