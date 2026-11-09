'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { scopedHref, sectionVisibility, selectedChoice, type BrandWorkspaceScope } from '@/lib/brands/workspace/selection';
import { useWorkspaceSelection } from './identity';
import { SupportDrawer } from './support';
import type { BrandCopy } from './action-form';

const NAV_ORDER_STORAGE_KEY = 'twings_brand_nav_order_v1';

/** The home logo and support conversation follow the same brand as the page; defaults to Studio when available or user's #1 ordered tab. */
export function WorkspaceHomeLink({ scope, children }: { scope: BrandWorkspaceScope; children: ReactNode }) {
  const choice = selectedChoice(useWorkspaceSelection(scope).selection);
  const vis = sectionVisibility(choice);
  const defaultEntry = vis.studio ? '/brand/studio' : '/brand';
  const [preferredEntry, setPreferredEntry] = useState<string>(defaultEntry);

  useEffect(() => {
    function syncPreferred() {
      try {
        const raw = window.localStorage.getItem(NAV_ORDER_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as unknown;
          if (Array.isArray(parsed) && typeof parsed[0] === 'string' && parsed[0].startsWith('/brand')) {
            if (parsed[0] === '/brand/studio' && !vis.studio) {
              setPreferredEntry('/brand');
              return;
            }
            setPreferredEntry(parsed[0]);
            return;
          }
        }
      } catch {
        // ignore
      }
      setPreferredEntry(vis.studio ? '/brand/studio' : '/brand');
    }
    syncPreferred();
    window.addEventListener('twings:nav-order-changed', syncPreferred);
    return () => window.removeEventListener('twings:nav-order-changed', syncPreferred);
  }, [vis.studio]);

  return <a href={scopedHref(preferredEntry, choice)} className="bw-lockup">{children}</a>;
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
