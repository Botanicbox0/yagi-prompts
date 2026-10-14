import { createHash } from 'node:crypto';
import type { PromptRow } from '@/lib/prompts/repo';
/** A studio edit invalidates the old cost quote instead of silently redeeming a different product. */
export function imageOfferFingerprint(row:PromptRow) {
 return createHash('sha256').update(JSON.stringify([row.id,row.promptText,row.engine,row.models,row.aspectDefault,row.medium])).digest('hex');
}
