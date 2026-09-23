'use client';
import { useRef, type KeyboardEvent } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  ORGANIZATION_QUERY, projectIdFromPath, resolveWorkspaceSelection, selectedChoice, switchHref,
  type BrandWorkspaceScope, type BrandChoiceRole,
} from '@/lib/brands/workspace/selection';
import type { BrandRole } from '@/lib/brands/workspace/types';
import { BrandAvatar } from './brand-avatar';

/** The URL decides the brand: a campaign page shows the brand that owns it, whatever the query says. */
export function useWorkspaceSelection(scope: BrandWorkspaceScope) {
  const pathname = usePathname() ?? '/brand';
  const params = useSearchParams();
  const projectId = projectIdFromPath(pathname);
  const query = params?.getAll(ORGANIZATION_QUERY) ?? [];
  const selection = resolveWorkspaceSelection(scope.choices, {
    routeOrganizationId: projectId ? scope.projectOrganizations[projectId] ?? null : null,
    query: query.length > 1 ? query : query[0] ?? null,
  });
  return { pathname, selection };
}

export interface IdentityCopy {
  label: string; switch: string; current: string; guest: string; none: string; unavailable: string;
}
/**
 * The brand under the TWINGS lockup. One brand: its identity, no control. Several: a disclosure of
 * plain links (keyboard, touch and no-JS all work), each keeping the current section when that
 * brand's role can open it.
 */
export function WorkspaceIdentity({ scope, copy, roles }: { scope: BrandWorkspaceScope; copy: IdentityCopy; roles: Record<BrandRole, string> }) {
  const { pathname, selection } = useWorkspaceSelection(scope);
  const details = useRef<HTMLDetailsElement>(null);
  const roleLabel = (role: BrandChoiceRole) => (role === 'guest' ? copy.guest : roles[role]);
  if (selection.state === 'none')
    return <div className="bw-identity" data-brand-identity="none"><p className="bw-identity-empty">{copy.none}</p></div>;
  const choice = selectedChoice(selection);
  const summary = choice ? (
    <>
      <BrandAvatar name={choice.name} logoUrl={choice.logoUrl} />
      <span className="bw-identity-text"><strong>{choice.name}</strong><small>{roleLabel(choice.role)}</small></span>
    </>
  ) : (
    <span className="bw-identity-text"><strong>{copy.unavailable}</strong></span>
  );
  if (choice && scope.choices.length === 1)
    return (
      <div className="bw-identity" data-brand-identity={choice.id} role="group" aria-label={copy.current}>
        <div className="bw-identity-current">{summary}</div>
      </div>
    );
  const close = (e: KeyboardEvent<HTMLDetailsElement>) => {
    if (e.key !== 'Escape' || !details.current?.open) return;
    details.current.open = false;
    details.current.querySelector('summary')?.focus();
  };
  return (
    <details className="bw-identity" data-brand-identity={choice?.id ?? 'unavailable'} ref={details} onKeyDown={close}>
      <summary className="bw-identity-current">
        <span className="bw-sr-only">{copy.switch}: </span>
        {summary}
        <svg className="bw-identity-chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" /></svg>
      </summary>
      <ul className="bw-identity-menu" aria-label={copy.switch}>
        {scope.choices.map((c) => (
          <li key={c.id}>
            <a href={switchHref(pathname, c)} aria-current={c.id === choice?.id ? 'true' : undefined} data-brand-choice={c.id}>
              <BrandAvatar name={c.name} logoUrl={c.logoUrl} size="sm" />
              <span className="bw-identity-text"><strong>{c.name}</strong><small>{roleLabel(c.role)}</small></span>
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
