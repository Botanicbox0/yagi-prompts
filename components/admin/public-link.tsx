import type { ComponentProps } from 'react';
import { publicHref, requestSurface } from '@/lib/routing/request-surface';

/** Keep public destinations usable without admitting consumer pages on the admin host. */
export async function PublicLink({ href, ...props }: ComponentProps<'a'> & { href: string }) {
  const { admin } = await requestSurface();
  return <a {...props} href={publicHref(href, admin)} />;
}
