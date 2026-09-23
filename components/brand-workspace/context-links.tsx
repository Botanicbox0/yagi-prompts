'use client';
import type { ReactNode } from 'react';
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
  const choice = selectedChoice(useWorkspaceSelection(scope).selection);
  // The support thread is the customer's own line to the studio; the TWINGS team answers it from /admin.
  if (!choice || choice.role === 'guest' || choice.role === 'studio') return null;
  // Remount on brand change: an open thread or unsent message must not carry into another brand.
  return <SupportDrawer key={choice.id} organizations={[{ id: choice.id, name: choice.name, role: choice.role }]} b={b} locale={locale} />;
}
