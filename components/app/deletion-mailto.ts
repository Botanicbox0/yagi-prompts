import type { Dictionary } from '@/lib/i18n/dictionaries';
import { interpolate } from '@/lib/i18n/format';

/** Audit P2-17: the account-deletion request mail, written in the reader's language (it was English only). */
export function deletionMailto(
  copy: Pick<Dictionary['account'], 'deletionMailSubject' | 'deletionMailBody' | 'deletionMailUnknown'>,
  email: string | null,
): string {
  const subject = encodeURIComponent(copy.deletionMailSubject);
  const body = encodeURIComponent(interpolate(copy.deletionMailBody, { email: email ?? copy.deletionMailUnknown }));
  return `mailto:hello@yagiworkshop.xyz?subject=${subject}&body=${body}`;
}
