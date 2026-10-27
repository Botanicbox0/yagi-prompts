'use server';

import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { platformAccess } from '@/lib/creator-platform/runtime';
import { ApplicationFieldError, submitCreatorApplication, type ApplicationField } from '@/lib/creator-platform/onboarding';
import { PlatformError } from '@/lib/creator-platform/contract';
import { CREATOR_APPLY_PATH, CREATOR_WORKSPACE_PATH } from '@/lib/creator-platform/links';

export type ApplicationResult = { ok: true } | { ok: false; code: string; field?: ApplicationField };

/**
 * The application boundary, with two entry points over one `run()`. A thin wrapper: identity from the session, gates from the server
 * env and schema, and every field re-validated by `submitCreatorApplication`.
 *
 * The hydrated form calls `submitApplicationAction` with a plain object and keeps its own
 * answers on any refusal or dropped connection.
 */
export async function submitApplicationAction(input: unknown): Promise<ApplicationResult> {
  return run(input);
}

/**
 * Before hydration or without JavaScript the form POSTs here as FormData. This path redirects, and
 * the URL carries only an error code and a field name — never an answer.
 */
export async function submitApplicationForm(form: FormData): Promise<void> {
  const result = await run(fromForm(form));
  if (result.ok) redirect(`${CREATOR_WORKSPACE_PATH}?ok=applied`);
  redirect(`${CREATOR_APPLY_PATH}?err=${encodeURIComponent(result.code)}${result.field ? `&field=${result.field}` : ''}`);
}

function fromForm(form: FormData) {
  const value = (name: string) => { const raw = form.get(name); return typeof raw === 'string' ? raw : ''; };
  return {
    requestId: value('requestId'), displayName: value('displayName'), portfolioUrl: value('portfolioUrl'),
    samples: ['sample1', 'sample2', 'sample3'].map((name) => value(name).trim()),
    mediums: form.getAll('mediums').filter((v): v is string => typeof v === 'string'),
    tools: value('tools'), message: value('message'), rights: value('rights') === 'on', program: value('program') === 'on',
  };
}

async function run(input: unknown): Promise<ApplicationResult> {
  const viewer = await getViewer();
  if (viewer.userId === null) return { ok: false, code: 'sign_in_required' };
  const sql = await getSqlRunner();
  if (sql === null) return { ok: false, code: 'unavailable' };
  try {
    await submitCreatorApplication(sql, viewer, input, await platformAccess(sql));
    return { ok: true };
  } catch (error) {
    if (error instanceof ApplicationFieldError) return { ok: false, code: 'invalid', field: error.field };
    if (error instanceof PlatformError) return { ok: false, code: error.code };
    return { ok: false, code: 'unavailable' };
  }
}
