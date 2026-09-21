'use client';
import { usePathname } from 'next/navigation';
export function WorkspaceNavigation({ home, members }: { home: string; members: string }) {
  const path = usePathname();
  return <nav><a href="/brand" aria-current={!path.startsWith('/brand/members') ? 'page' : undefined}><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3" width="14" height="14" rx="2"/><path d="M3 8h14M8 8v9"/></svg>{home}</a><a href="/brand/members" aria-current={path.startsWith('/brand/members') ? 'page' : undefined}><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8" cy="6" r="3"/><path d="M2 17v-2a6 6 0 0 1 12 0v2M14 3a3 3 0 0 1 0 6m2 3a5 5 0 0 1 2 4v1"/></svg>{members}</a></nav>;
}
