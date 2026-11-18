'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { scopedHref, sectionVisibility, selectedChoice, type BrandWorkspaceScope } from '@/lib/brands/workspace/selection';
import { BRAND_HOME_PATH, brandHomeVisible } from '@/lib/brands/workspace/home';
import { useWorkspaceSelection } from './identity';
import { SupportDrawer } from './support';
import type { BrandCopy } from './action-form';

const NAV_ORDER_STORAGE_KEY = 'twings_brand_nav_order_v1';

/**
 * The home logo and support conversation follow the same brand as the page. A brand with the workspace
 * home (`home`: studio v2 is on, docs/BRAND-STUDIO-V3.md §12) always goes home; otherwise the logo opens
 * the studio when available, or the user's #1 ordered tab.
 */
export function WorkspaceHomeLink({ scope, children, home = false }: { scope: BrandWorkspaceScope; children: ReactNode; home?: boolean }) {
  const choice = selectedChoice(useWorkspaceSelection(scope).selection);
  const vis = sectionVisibility(choice);
  const hasHome = home && brandHomeVisible(choice, true);
  const defaultEntry = hasHome ? BRAND_HOME_PATH : vis.studio ? '/brand/studio' : '/brand';
  const [preferredEntry, setPreferredEntry] = useState<string>(defaultEntry);

  useEffect(() => {
    function syncPreferred() {
      if (hasHome) {
        setPreferredEntry(BRAND_HOME_PATH);
        return;
      }
      try {
        const raw = window.localStorage.getItem(NAV_ORDER_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as unknown;
          if (Array.isArray(parsed) && typeof parsed[0] === 'string' && parsed[0].startsWith('/brand')) {
            // The rail (docs/BRAND-STUDIO-V3.md §3) can put a studio sub-screen first; the lockup only
            // ever lands on the image studio, and never on any studio address for a brand without it.
            if (parsed[0].startsWith('/brand/studio')) {
              setPreferredEntry(vis.studio ? '/brand/studio' : '/brand');
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
  }, [vis.studio, hasHome]);

  return <a href={scopedHref(preferredEntry, choice)} className="bw-lockup" aria-label="TWINGS Studio">{children}</a>;
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
