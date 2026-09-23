import { tossConfigFromEnv } from '@/lib/billing/toss-gateway';
import { brandUsagePaymentsOpen } from '@/lib/flags';

/**
 * Which deployment is running, for the secondary-usage money path (docs/SECONDARY-USAGE.md §3).
 *
 * `production` is Vercel's own `VERCEL_ENV=production`, never a request value. On production a binding
 * grant needs a LIVE payment: test keys and the local fake may still run the flow on previews and locally,
 * but there they can never mint a grant. Server code passes this explicitly; tests inject it.
 */
export interface UsageRuntime { production: boolean }
export const usageRuntimeFromEnv = (env: NodeJS.ProcessEnv = process.env): UsageRuntime => ({ production: env.VERCEL_ENV === 'production' });

/**
 * Whether acceptance and checkout are open here: the rollout flag is on, and on production the Toss keys
 * are live ones. Misconfigured keys close payments rather than throwing into a page.
 */
export function usagePaymentsOpen(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!brandUsagePaymentsOpen(env)) return false;
  if (!usageRuntimeFromEnv(env).production) return true;
  try { return tossConfigFromEnv(env)?.kind === 'live'; } catch { return false; }
}
