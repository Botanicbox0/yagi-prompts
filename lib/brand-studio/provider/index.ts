/**
 * The API-lane provider for this environment: the fake (no network, no money) or Sunra's queue.
 * Null when live but `SUNRA_API_KEY` is missing: the router then treats the API lane as down.
 */
import { sunraConfigFromEnv } from '@/lib/sunra/client';
import type { StudioEnv } from '../env';
import { sharedFakeStudioProvider } from './fake';
import { createSunraStudioProvider } from './sunra-api';
import type { StudioProvider } from './types';

export function selectStudioProvider(
  env: StudioEnv,
  source: Record<string, string | undefined> = process.env,
  deps: { fetch?: typeof fetch; log?: (event: string, detail?: Record<string, unknown>) => void } = {},
): StudioProvider | null {
  if (env.provider === 'fake') return sharedFakeStudioProvider();
  const config = sunraConfigFromEnv(source);
  return config ? createSunraStudioProvider(config, deps) : null;
}

export type { StudioProvider, StudioTaskStatus, StudioProviderRequest } from './types';
export { StudioProviderError } from './types';
