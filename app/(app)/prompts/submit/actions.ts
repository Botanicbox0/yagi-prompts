'use server';

import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getStorage } from '@/lib/storage';
import { submitPrompt } from '@/lib/prompts/submit';
import { PROMPT_SUBMIT_PATH } from '@/lib/prompts/links';
import { bool, file, str, text } from '@/lib/admin/form';

/**
 * PLAN §13.1/E — the ONE community submission action.
 *
 * The same shape as `app/(admin)/admin/actions.ts`: a thin `'use server'` wrapper that resolves the
 * three dependencies (viewer, database, storage) and hands them to an injectable service which owns
 * every decision. Nothing is trusted from the form except the fields a submitter is allowed to
 * choose — the author id, the status and the text visibility are all supplied by the server (see
 * `lib/prompts/submit.ts`), so there is no field a caller could add to publish their own row.
 *
 * The form is JS-free (plain multipart POST + `?ok/err` codes), like the admin editor, so the
 * submission path keeps working with scripts blocked and there is no client-side validation to
 * mistake for a gate.
 */
export async function submitPromptAction(form: FormData): Promise<void> {
  const outcome = await run(form);
  redirect(`${PROMPT_SUBMIT_PATH}?${outcome}`);
}

async function run(form: FormData): Promise<string> {
  const viewer = await getViewer();
  if (viewer.userId === null) return 'err=sign_in_required';

  const [sql, storage] = await Promise.all([getSqlRunner(), getStorage()]);
  if (sql === null) return 'err=invalid&detail=no+database+configured';

  const result = await submitPrompt(
    { sql, storage },
    viewer,
    {
      title: str(form, 'title'),
      promptText: text(form, 'promptText'),
      useCase: form.getAll('useCase').filter((v): v is string => typeof v === 'string'),
      handle: str(form, 'handle') || null,
      consent: bool(form, 'consent'),
      video: file(form, 'video'),
      poster: file(form, 'poster'),
    },
  );

  if (result.ok) return `ok=1&slug=${encodeURIComponent(result.slug)}`;
  const detail = 'detail' in result && result.detail ? `&detail=${encodeURIComponent(String(result.detail))}` : '';
  return `err=${result.code}${detail}`;
}
