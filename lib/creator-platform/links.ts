import { localizedPath, type Locale } from '@/lib/i18n/config';

/** The public program page and its two login-gated leaves (registered in lib/i18n/config.ts). */
export const CREATOR_PROGRAM_REST = '/creators';
export const CREATOR_APPLY_PATH = '/creators/apply';
export const CREATOR_WORKSPACE_PATH = '/creators/workspace';

export function creatorProgramHref(locale: Locale): string {
  return localizedPath(locale, CREATOR_PROGRAM_REST);
}

/**
 * Public intake is closed unless BOTH the existing supplier gate and the separate application gate
 * are on. Server env only: a client bundle reads `undefined` and therefore stays closed.
 * Schema readiness is checked again per request by `platformAccess()`.
 */
export function creatorProgramOpen(env: Record<string, string | undefined> = process.env): boolean {
  return env.TWINGS_FORMAT_CREATORS === 'on' && env.TWINGS_CREATOR_APPLICATIONS === 'on';
}
