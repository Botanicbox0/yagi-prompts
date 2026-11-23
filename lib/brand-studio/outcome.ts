import { createHash } from 'node:crypto';
import type { UploadLimitReason } from '@/lib/brands/upload-limits-format';
import type { StudioErrorCode, StudioFailure } from './contracts';
import { StudioDenied } from './access';

export const failure = (code: StudioErrorCode, reason?: UploadLimitReason): StudioFailure =>
  reason ? { ok: false, code, reason } : { ok: false, code };

/** Run `fn`; a `StudioDenied` becomes its code, a unique-key race becomes `conflict`. Anything else propagates. */
export async function guarded<T>(fn: () => Promise<T>): Promise<T | StudioFailure> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof StudioDenied) return failure(error.code, error.reason);
    if ((error as { code?: string } | null)?.code === '23505') return failure('conflict');
    throw error;
  }
}

/**
 * A stable RFC 9562 version-5-shaped UUID from text, for services that key idempotency on a UUID
 * (`createBrandProject`, `reserveBrandAttachment`) while the studio's request ids are free strings.
 */
export function derivedUuid(...parts: string[]): string {
  const h = createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32).split('');
  h[12] = '5';
  h[16] = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}
