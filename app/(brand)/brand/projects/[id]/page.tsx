import { campaignListReturnPath } from "@/lib/brands/workspace/navigation";
import { notFound } from "next/navigation";
import { brandContext } from "@/components/brand-workspace/context";
import { ProjectDetail } from "@/components/brand-workspace/project-detail";
import { CampaignApplicants, CampaignPayments } from "@/components/brand-workspace/campaign-sections";
import { loadBrandProject } from "@/lib/brands/workspace/service";
import { loadBrandUsage } from "@/lib/brands/usage/service";
import { usagePaymentsOpen } from "@/lib/brands/usage/runtime";
import { adminProjectHref } from "@/components/brand-workspace/staff-notice";
import { loadProjectApplicants, loadProjectCollaboration } from "@/lib/campaigns/collaboration/service";
import { loadFundingProject } from "@/lib/campaigns/funding/service";
import { fundingDeps, fundingRuntime } from "@/lib/campaigns/funding/runtime";
import { open } from "@/lib/campaigns/funding/core";
import { loadPromptBySlug } from "@/lib/prompts/repo";
import { influencersOpen } from "@/lib/influencers/rules";
import { poolVisible, scopedHref } from "@/lib/brands/workspace/selection";
import { POOL_PATH } from "@/lib/brands/creator-pool";
export default async function BrandProject({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, { sql, viewer, verifiedEmail, brandHost, b, locale }, search] = await Promise.all([
    params,
    brandContext(),
    searchParams ?? Promise.resolve({} as Record<string, string | string[] | undefined>),
  ]);
  if (!sql) return <p role="alert">{b.unavailable}</p>;
  const project = await loadBrandProject({ sql, verifiedEmail }, viewer, id);
  if (!project) notFound();
  // Applicants and payment are the brand's own matters: no such tabs for campaign-only guests or the TWINGS view.
  const member = project.role === "owner" || project.role === "editor" || project.role === "viewer";
  const [usage, collaboration, applicants, funding] = await Promise.all([
    loadBrandUsage({ sql, verifiedEmail, paymentsOpen: usagePaymentsOpen() }, viewer, id),
    member ? loadProjectCollaboration({ sql }, viewer, id) : Promise.resolve(null),
    member ? loadProjectApplicants({ sql }, viewer, id) : Promise.resolve(null),
    member ? loadFundingProject({ sql }, viewer, id) : Promise.resolve(null),
  ]);
  const deps = member ? fundingDeps(sql) : null;
  const requested = project.campaignTerms?.format.kind === "template" ? await loadPromptBySlug(sql, project.campaignTerms.format.slug).catch(() => null) : null;
  const formatTitle = requested ? (locale === "ko" && requested.titleKo ? requested.titleKo : requested.title) : null;
  // `studio` here is the TWINGS team's read-only view (never the customer's seat): no approve, upload or comment.
  return (
    <ProjectDetail
      backHref={campaignListReturnPath(search.returnTo, project.organizationId)}
      project={project}
      b={b}
      locale={locale}
      usage={usage}
      formatTitle={formatTitle}
      staffManageHref={project.role === "studio" && viewer.isAdmin ? adminProjectHref(project.id, brandHost) : null}
      applicants={member ? (
        <CampaignApplicants view={applicants} invitations={collaboration?.campaigns ?? []} canInvite={Boolean(collaboration?.canInvite) && !viewer.isAdmin} b={b} locale={locale} projectId={id}
          poolHref={influencersOpen() && poolVisible(project) ? scopedHref(POOL_PATH, { id: project.organizationId }) : null} />
      ) : null}
      payments={member ? (
        <CampaignPayments view={funding} rollout={fundingRuntime().enabled} enabled={deps !== null && open(deps)} failed={Boolean(search.failed)} b={b} locale={locale} projectId={id} />
      ) : null}
    />
  );
}
