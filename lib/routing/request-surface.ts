import { headers } from 'next/headers';
import { REQUEST_ORIGIN_HEADER, SURFACE_HEADER } from './surfaces';

/** These headers are overwritten by middleware on every route, including auth and assets. */
export async function requestSurface() {
  const values = await headers();
  const admin = values.get(SURFACE_HEADER) === 'admin';
  const origin = values.get(REQUEST_ORIGIN_HEADER);
  return { admin, origin };
}

/** Public links leave only the dedicated admin host; local/preview links stay relative. */
export function publicHref(path: string, admin: boolean): string {
  return admin ? `https://twings.app${path}` : path;
}
