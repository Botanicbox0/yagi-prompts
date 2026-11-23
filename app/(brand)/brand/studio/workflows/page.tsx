import type { Metadata } from 'next';
import { brandContext } from '@/components/brand-workspace/context';
import { brandScope } from '@/components/brand-workspace/scope';
import { studioRouteOrShowroom } from '@/components/brand-studio/route-context';
import { StudioShowroom } from '@/components/brand-studio/studio-showroom';
import { WorkflowsHub } from '@/components/brand-studio/workflows/workflows-hub';
import { studioEnv } from '@/lib/brand-studio/env';
import { listMcpTokens, normalizeMcpOrigin } from '@/lib/brand-studio/mcp';
import { DEFAULT_MCP_ORIGIN } from '@/lib/brand-studio/mcp/clients';
import { createStudioMediaStore } from '@/lib/brand-studio/media-store';
import { assetView, assetsOf, jobsOf, viewsOf } from '@/lib/brand-studio/repo';
import { allowanceView, loadAllowance } from '@/lib/brand-studio/usage';
import { studioShowroomVisible, studioV2Visible } from '@/lib/brand-studio/visibility';
import { listOrgPlaybooks, listOrgWorkflows, STARTER_WORKFLOWS, toRecentRunSummaries } from '@/lib/brand-studio/workflows';
import type { RecentRunSummaryWire } from '@/lib/brand-studio/workflows/contracts';
import { featureDenied } from '@/lib/brands/features';
import { scopedHref } from '@/lib/brands/workspace/selection';
import { brandStudioV2Open } from '@/lib/flags';

/**
 * `/brand/studio/workflows` — Organization Workflows, Character Sheet Maker, Knowledge Hub,
 * and Multi-Client MCP Connect (`docs/STUDIO-PRO-SUITE-V4.md` §1.5).
 *
 * First line calls `studioRouteOrShowroom(organizationId)`:
 * - Morphic/sandboxed organizations (`d425c3b1...`, `deb648e9...`, `Morphic`/`모픽`),
 *   `generative_media`-denied organizations, campaign-only guests, and deployments with
 *   `BRAND_STUDIO_V2` off all receive `404` before any query runs.
 * - Non-subscribed `project_only` organizations render `<StudioShowroom />`.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}): Promise<Metadata> {
  if (!brandStudioV2Open()) return {};
  const [{ organizationId }, { sql, viewer, verifiedEmail, dict }] = await Promise.all([
    searchParams,
    brandContext(),
  ]);
  if (!sql) return {};
  const { choice } = await brandScope({ sql, verifiedEmail }, viewer, organizationId);
  if (!choice || (!studioV2Visible(choice, true) && !studioShowroomVisible(choice, true))) return {};
  return { title: dict.studioWorkflows.title };
}

export default async function StudioWorkflowsPage({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  const params = await searchParams;
  const ctx = await studioRouteOrShowroom(params.organizationId);
  const { choice, access, locale, dict, brandHost } = ctx;

  if (ctx.kind === 'showroom') {
    return (
      <StudioShowroom
        focus="image"
        organizationId={choice.id}
        organizationName={choice.name}
        canRequest={!access.staff && access.canRequest}
        imageHref={scopedHref('/brand/studio', choice)}
        videoHref={scopedHref('/brand/studio/video', choice)}
        projectSpaceHref={scopedHref('/brand', choice)}
        newBriefHref={scopedHref('/brand/projects/new', choice)}
        copy={dict.studioShell.showroom}
      />
    );
  }

  const { deps, viewer } = ctx;
  const media = createStudioMediaStore();
  const env = studioEnv();
  const agentAccessAllowed = !featureDenied(choice.denied, 'agent_access');

  const [rawAssets, rawJobs, allowance, customWorkflows, playbooks, tokensRes] = await Promise.all([
    assetsOf(deps.sql, choice.id, 160),
    jobsOf(deps.sql, choice.id, 24),
    loadAllowance(deps.sql, choice.id, env),
    listOrgWorkflows(deps.sql, choice.id),
    listOrgPlaybooks(deps.sql, choice.id),
    agentAccessAllowed ? listMcpTokens(deps.sql, viewer, choice.id).catch(() => null) : Promise.resolve(null),
  ]);

  const allAssets = rawAssets.map((a) => assetView(a, media));
  const imageAssets = allAssets.filter((a) => a.kind === 'image');
  const videoAssets = allAssets.filter((a) => a.kind === 'video');

  const jobViews = await viewsOf(deps.sql, rawJobs, media);
  const imageOutputs = jobViews.flatMap((job) =>
    job.outputs
      .filter((out) => out.kind === 'image')
      .map((out, idx) => ({
        ...out,
        label: job.prompt.trim().slice(0, 38) || `${dict.brandStudio.title} ${idx + 1}`,
      })),
  );

  // The same list the hub state builds (never a preset run: it cannot be saved as a workflow).
  const recentRuns: RecentRunSummaryWire[] = toRecentRunSummaries(jobViews);

  const canCreate = !access.staff && (choice.role === 'owner' || choice.role === 'editor');
  const mcpOrigin = ctx.requestOrigin
    ? normalizeMcpOrigin(ctx.requestOrigin)
    : brandHost
      ? DEFAULT_MCP_ORIGIN
      : env.appOrigin ?? DEFAULT_MCP_ORIGIN;

  return (
    <WorkflowsHub
      organizationId={choice.id}
      locale={locale}
      canCreate={canCreate}
      agentAccessAllowed={agentAccessAllowed}
      mcpOrigin={mcpOrigin}
      copy={dict.studioWorkflows}
      imageStudioHref={scopedHref('/brand/studio', choice)}
      videoStudioHref={scopedHref('/brand/studio/video', choice)}
      assetsHref={scopedHref('/brand/library', choice)}
      initialAllowance={allowanceView(allowance)}
      initialStarters={[...STARTER_WORKFLOWS]}
      initialWorkflows={customWorkflows}
      initialPlaybooks={playbooks}
      initialRecentRuns={recentRuns}
      initialImageAssets={imageAssets}
      initialVideoAssets={videoAssets}
      initialImageOutputs={imageOutputs}
      initialMcpTokens={tokensRes && tokensRes.ok ? tokensRes.tokens : []}
    />
  );
}
