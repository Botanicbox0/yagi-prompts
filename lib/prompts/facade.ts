import 'server-only';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import {
  PROMPT_NOT_FOUND,
  shapePromptDetail,
  type PromptDetailResult,
} from './access';

export type { PromptDetailOk, PromptDetailResult } from './access';

/**
 * PLAN §13.2 — `getShapedPrompt(slug)`, the façade the detail route calls.
 *
 * Same contract as `lib/content/facade.ts`: it resolves the session ITSELF, and there is no
 * parameter through which a caller could hand it a tier. That is what keeps
 * `app/(marketing)/[locale]/prompts/[slug]/page.tsx` free of any session import — the cache
 * contract test scans that whole tree for one.
 */
export async function getShapedPrompt(slug: string): Promise<PromptDetailResult> {
  const [sql, viewer] = await Promise.all([getSqlRunner(), getViewer()]);
  // No database ⇒ nothing is published ⇒ 404. Fail closed, exactly like the playbook façade.
  if (sql === null) return PROMPT_NOT_FOUND;
  return shapePromptDetail({ sql, viewer }, slug);
}
