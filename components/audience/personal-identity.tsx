import type { ReactNode } from 'react';
import identity from '@/components/design/identity.module.css';

/**
 * docs/design/IDENTITY.md on the personal side (2026-11-03): the same `.identity` the brand landing wraps
 * itself in, plus the personal scope that points the site tokens at it (canvas ground, ink, identity line).
 * `display: contents`, so it adds no box; the nav, the page and the footer all sit inside it.
 */
export function PersonalIdentity({ children }: { children: ReactNode }) {
  return <div data-personal-identity className={`${identity.identity} ${identity.personal}`}>{children}</div>;
}
