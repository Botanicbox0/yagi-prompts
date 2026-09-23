import { BUSINESS } from '@/lib/legal/documents';

/**
 * Audit P2-17: the company line under every mail, in the mail's language. English mails used to
 * carry the Korean company name and address. Values come from `BUSINESS` (lib/legal/documents.ts).
 */
export function companyName(locale: string): string {
  return locale === 'ko' ? BUSINESS.nameKo : BUSINESS.name;
}

export function companyLine(locale: string, parts: { address?: boolean } = {}): string {
  const ko = locale === 'ko';
  return [companyName(locale), ...(parts.address ? [ko ? BUSINESS.address : BUSINESS.addressEn] : []), BUSINESS.email].join(' · ');
}
