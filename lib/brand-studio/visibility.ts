/**
 * Who sees studio v2 (docs/BRAND-STUDIO-V2.md §3).
 *
 * The single question every v2 page, API route, home section and menu asks before showing anything.
 * A sandboxed client organization (Morphic) and any organization whose policy closes generative media
 * get `false`: no page, no door, no panel, no hint that the studio exists.
 *
 * Client-safe (no env, no db). The server reads the flag (`brandStudioV2Open()` in lib/flags.ts) and
 * passes it in as `flagOn`, so a client component never reads an environment variable.
 */
import { featureDenied, isSandboxedClientOrganization } from '@/lib/brands/features';

export interface StudioVisibilityOrg {
  id?: string | null;
  name?: string | null;
  /** The organization's denied features, sandbox defaults already merged (lib/brands/workspace/service.ts). */
  denied?: readonly string[] | null;
}

export function studioV2Visible(org: StudioVisibilityOrg | null | undefined, flagOn: boolean): boolean {
  if (!flagOn || !org) return false;
  if (isSandboxedClientOrganization(org)) return false;
  if (featureDenied(org.denied, 'generative_media')) return false;
  return !featureDenied(org.denied, 'self_studio');
}

/**
 * Whether the unified Brand Asset Hub (`/brand/library`) is available for this organization.
 * Non-subscribing commissioned clients (`self_studio` denied, `generative_media` open) keep the Asset Hub
 * so they can upload brand packshots/logos and pick them in project briefs, while Morphic and
 * `generative_media`-denied organizations stay on the legacy campaign library.
 */
export function assetHubVisible(org: StudioVisibilityOrg | null | undefined, flagOn: boolean): boolean {
  if (!flagOn || !org) return false;
  if (isSandboxedClientOrganization(org)) return false;
  return !featureDenied(org.denied, 'generative_media');
}

/**
 * May this viewer's pages carry studio copy at all? The workspace layout serializes its navigation
 * copy into the page, so a viewer whose brands are ALL sandboxed or generation-closed must not be
 * handed the strings in the first place: hiding the markup is not enough. A viewer with at least one
 * open brand (or the TWINGS team) gets the copy; which brand is selected is decided in the browser.
 */
export function studioCopyAllowed(choices: readonly StudioVisibilityOrg[]): boolean {
  return choices.some((org) => !isSandboxedClientOrganization(org) && !featureDenied(org.denied, 'generative_media'));
}
