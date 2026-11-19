import { notFound } from 'next/navigation';
import { EditorV2 } from '@/components/brand-studio/editor-v2/editor-v2';
import { studioRouteContext } from '@/components/brand-studio/route-context';
import { scopedHref } from '@/lib/brands/workspace/selection';
import { brandStudioEditorV2Open } from '@/lib/flags';

/**
 * `/brand/studio/editor` — the editing studio v2 structure prototype (docs/BRAND-EDITING-STUDIO-V2.md).
 *
 * The studio route guard runs first: a sandboxed organization, an organization whose policy closes
 * generative media, a project-only guest, a brand without a studio seat and a deployment with
 * `BRAND_STUDIO_V2` off all get 404 before anything else is decided. Then the page's own flag,
 * `BRAND_STUDIO_EDITOR_V2` (default off). The screen runs on sample footage and reads nothing of the
 * organization's: no query, no storage, no request leaves the page.
 */
export const dynamic = 'force-dynamic';

export default async function StudioEditorV2Page({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  const params = await searchParams;
  const { choice, dict } = await studioRouteContext(params.organizationId);
  if (!brandStudioEditorV2Open()) notFound();
  return <EditorV2 copy={dict.studioEditor} currentEditorHref={scopedHref('/brand/studio/compose', choice)} />;
}
