import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { storefrontOpen } from '@/lib/auth/purchase-gate';
import { getSqlRunner } from '@/lib/db/connect';
import { assetLibraryMode, identityStatusFor, needsLiveness } from '@/lib/identity/service';
import { resolveEngine } from '@/lib/images/engines';
import { loadPreferences } from '@/lib/notify/preferences';
import { loadPromptBySlug } from '@/lib/prompts/repo';
import { canStartRender } from '@/lib/renders/service';
import { portraitEnabled } from '@/lib/identity/portrait-runtime';
import { getSubscriptionSummary, getSubscriptionUsePercent } from '@/lib/creator-subscriptions/repo';
import { subscriptionQaAllowed } from '@/lib/creator-subscriptions/access';
import { billingConfigFromEnv } from '@/lib/creator-subscriptions/gateway';
import { premiumEditingOperational } from '@/lib/creator-subscriptions/runtime';
import { subscriptionTemplateEligibility } from '@/lib/premium-editing/eligibility';
import type { SubscriptionSummary } from '@/lib/creator-subscriptions/types';
import type { EditScope } from '@/lib/premium-editing/contract';
import { getPremiumEditBudget, type PremiumEditBudget } from '@/lib/premium-editing/budget';

/**
 * `GET /api/renders/access?template=slug` — what THIS viewer's make button should do on THIS
 * template. The template page is static (one HTML for everyone), so the studio asks at mount:
 *
 *   open              is the SHOP open at all — a signed-out visitor should be offered "sign in to
 *                     buy" rather than "곧 열립니다". Distinct from `live`, which is about THIS viewer.
 *   live              may this viewer start a real render at all (the same rule the enqueue route applies)
 *   charge            will a payment be taken — false for operators (@yagiworkshop.xyz admins test for
 *                     free, founder 2026-09-10) and, until payment is wired, for everyone
 *   identityRequired  does the template's engine need a verified face (ModelArk) — docs §8.2
 *   identity          where this viewer stands on that: none · pending · active · failed · not_needed
 *
 * A viewer who forges any of this only reaches the refusals the enqueue route already carries.
 */
export const dynamic = 'force-dynamic';

const HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

export async function GET(request: Request): Promise<NextResponse> {
  const viewer = await getViewer();
  let live = canStartRender(viewer);
  const slug = new URL(request.url).searchParams.get('template');
  const signedIn = viewer.userId !== null;

  let identityRequired = false;
  let identity: string = 'not_needed';
  // The closed studio's one question: has this person already asked to be told when it opens?
  let interest = false;
  const portraits = portraitEnabled() && !viewer.isAdmin;
  let portraitId: string | null = null;
  let subscription: SubscriptionSummary | null = null;
  let subscriptionEligible = false;
  let subscriptionUsePercent: number | null = null;
  let editing = false;
  let editFields: EditScope[] = [];
  let premiumEditBudget: PremiumEditBudget | null = null;
  if (viewer.userId !== null) {
    const sql = await getSqlRunner();
    if (sql !== null) {
      if (portraits) portraitId = (await sql.query<{attempt_id:string}>('select attempt_id from identity_portrait_selections where user_id=$1',[viewer.userId])).rows[0]?.attempt_id ?? null;
      interest = (await loadPreferences(sql, viewer.userId))?.newPlaybook === true;
      const candidate = slug ? await loadPromptBySlug(sql, slug) : null;
      const template = candidate?.audience === 'brand' ? null : candidate;
      // A quote describes use; only a paid, owned, unexpired ledger grants access.
      try {
        const environment = billingConfigFromEnv()?.kind ?? 'live';
        if (environment === 'live' || subscriptionQaAllowed(viewer)) {
          subscription = await getSubscriptionSummary(sql, viewer.userId, { environment });
          const eligibility = template ? subscriptionTemplateEligibility(template) : null;
          subscriptionEligible = Boolean(eligibility);
          if (subscription?.hasAccess && eligibility) {
            live = true;
            subscriptionUsePercent = await getSubscriptionUsePercent(sql, viewer.userId, environment, eligibility.quote.units);
            editing = subscription.planId === 'premium' && await premiumEditingOperational(sql, environment);
            editFields = editing ? eligibility.scopes : [];
            if (editing) premiumEditBudget = await getPremiumEditBudget(sql, viewer.userId, { environment });
          }
        }
      } catch { /* Deploying before the new ledger exists retains the existing one-time studio. */ }
      if (template !== null) {
        // Only the liveness mode has a camera step to announce; the virtual library needs nothing from the person.
        const mode = assetLibraryMode();
        identityRequired = needsLiveness(resolveEngine(template.engine, template.medium), mode);
        if (identityRequired) identity = await identityStatusFor(sql, viewer.userId, mode);
      }
    }
  }

  return NextResponse.json({ open: storefrontOpen(), live, charge: canStartRender(viewer) && !viewer.isAdmin, identityRequired, identity, signedIn, interest, portraitEnabled: portraits && signedIn, portraitId, subscription, subscriptionEligible, subscriptionUsePercent, editing, editFields, premiumEditBudget }, { headers: HEADERS });
}
