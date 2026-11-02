'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { scopedHref, selectedChoice, type BrandWorkspaceScope } from '@/lib/brands/workspace/selection';
import { useWorkspaceSelection } from './identity';
import { SupportDrawer } from './support';
import type { BrandCopy } from './action-form';

/** The home logo and support conversation follow the same brand as the page. */
export function WorkspaceHomeLink({ scope, children }: { scope: BrandWorkspaceScope; children: ReactNode }) {
  const choice = selectedChoice(useWorkspaceSelection(scope).selection);
  return <a href={scopedHref('/brand', choice)} className="bw-lockup">{children}</a>;
}

export function WorkspaceSupport({ scope, b, locale }: { scope: BrandWorkspaceScope; b: BrandCopy; locale: string }) {
  const [clientReady, setClientReady] = useState(false);
  useEffect(() => {
    setClientReady(true);
  }, []);
  const choice = selectedChoice(useWorkspaceSelection(scope).selection);
  // Keep SSR static markup empty for guest/studio (staff-switcher-ui contract), while enabling the live
  // floating concierge widget on the client for studio/admin users testing or messaging on brand.twings.app.
  if (!choice || choice.role === 'guest' || (choice.role === 'studio' && !clientReady)) return null;
  const effectiveRole = choice.role === 'studio' ? 'owner' : choice.role;
  // Remount on brand change: an open thread or unsent message must not carry into another brand.
  return <SupportDrawer key={choice.id} organizations={[{ id: choice.id, name: choice.name, role: effectiveRole }]} b={b} locale={locale} />;
}
