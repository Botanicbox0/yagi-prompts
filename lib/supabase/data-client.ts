import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from './service-client';

/**
 * PLAN §7 — factory #2 of two: the SERVICE-ROLE client.
 *
 * `import 'server-only'` is the guard: any accidental import from a client component is a build
 * error, not a runtime leak. Everything gated is read through this client inside RSC/route
 * handlers and shaped per a server-verified session (§3.4 "enforcement is server-side only").
 *
 * The browser never sees this key and never queries data.
 *
 * M7 moved the construction itself into `./service-client` (same options, same memo) because the
 * storage driver and the cloud smoke script run under `tsx`, where importing `server-only` throws.
 * This module stays the app's only door, and keeps the guard.
 */
export function createDataClient(): SupabaseClient {
  return createServiceClient();
}
