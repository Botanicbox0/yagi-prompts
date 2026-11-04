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
import { loadBrandShortlist, loadStudioShortlist } from "@/lib/brands/shortlist/service";
import { CampaignShortlist } from "@/components/brand-workspace/shortlist";
import { ShortlistAdmin } from "@/components/brand-workspace/shortlist-admin";
import { OutcomeBanner } from "@/components/admin/chrome";
import { BrandStatusForms } from "@/components/admin/brand-status";
import { StudioCoverForm } from "@/components/brand-workspace/studio-cover-forms";
import { loadFeaturePolicy } from "@/lib/brands/entitlements";
import { featureDenied, isSandboxedClientOrganization } from "@/lib/brands/features";
export default async function BrandProject({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, { sql, viewer, verifiedEmail, brandHost, b, dict, locale }, search] = await Promise.all([
    params,
    brandContext(),
    searchParams ?? Promise.resolve({} as Record<string, string | string[] | undefined>),
  ]);
  if (!sql) return <p role="alert">{b.unavailable}</p>;
  const project = await loadBrandProject({ sql, verifiedEmail }, viewer, id);
  if (!project) notFound();
  // Applicants and payment are the brand's own matters: no such tabs for campaign-only guests or the TWINGS view.
  const member = project.role === "owner" || project.role === "editor" || project.role === "viewer";
  // A DB admin in the TWINGS team view manages the shortlist here too (docs/BRAND-STAFF-ACCESS.md).
  const studioTools = project.role === "studio" && viewer.isAdmin;
  // The shortlist is for everyone who can see the campaign, guests included: comparing candidates is why they were invited.
  const [usage, collaboration, applicants, funding, shortlist, studioShortlist, policy] = await Promise.all([
    loadBrandUsage({ sql, verifiedEmail, paymentsOpen: usagePaymentsOpen() }, viewer, id),
    member ? loadProjectCollaboration({ sql }, viewer, id) : Promise.resolve(null),
    member ? loadProjectApplicants({ sql }, viewer, id) : Promise.resolve(null),
    member ? loadFundingProject({ sql }, viewer, id) : Promise.resolve(null),
    loadBrandShortlist({ sql, verifiedEmail }, viewer, id),
    studioTools ? loadStudioShortlist({ sql }, viewer, id) : Promise.resolve(null),
    loadFeaturePolicy(sql, project.organizationId).catch(() => ({ denied: [] as const })),
  ]);
  const generativeMediaAllowed =
    !isSandboxedClientOrganization({ id: project.organizationId, name: project.organizationName }) &&
    !featureDenied(policy.denied, "generative_media");
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
      generativeMediaAllowed={generativeMediaAllowed}
      usage={usage}
      formatTitle={formatTitle}
      staffManageHref={project.role === "studio" && viewer.isAdmin ? adminProjectHref(project.id, brandHost) : null}
      staffTools={studioTools ? (
        // Every form here returns to #studio-tools, so the outcome banner is in view after the post.
        <div id="studio-tools" data-studio-tools>
          <OutcomeBanner dict={dict.admin} ok={typeof search.ok === "string" ? search.ok : undefined}
            err={typeof search.err === "string" ? search.err : undefined} detail={typeof search.detail === "string" ? search.detail : undefined} />
          <section className="bw-panel" data-studio-status={project.status}>
            <h2>{b.projectStatus}</h2>
            <BrandStatusForms brandHost back={`/brand/projects/${project.id}#studio-tools`} projectId={project.id} status={project.status}
              revision={project.revision} b={b} admin={dict.admin} />
          </section>
          <section className="bw-panel" data-studio-cover={project.coverUrl ? "set" : "none"}>
            <h2>{b.cover.title}</h2>
            {search.cover === "failed" && <p role="alert" className="bw-error" data-studio-cover-failed>{b.studioPrep.coverFailed}</p>}
            <p className="bw-muted">{b.studioPrep.coverHint}</p>
            <StudioCoverForm b={b} projectId={project.id} revision={project.revision} hasCover={Boolean(project.coverUrl)} />
          </section>
          <ShortlistAdmin projectId={project.id} view={studioShortlist} back={`/brand/projects/${project.id}#studio-tools`}
            copy={b.shortlistAdmin} locale={locale} brandHost />
        </div>
      ) : null}
      shortlistCount={shortlist?.candidates.length ?? 0}
      shortlist={shortlist && shortlist.candidates.length > 0 ? (
        <CampaignShortlist candidates={shortlist.candidates} canPick={shortlist.canPick} copy={b.shortlist} locale={locale}
          manageHref={studioTools ? "#studio-tools" : undefined} projectId={project.id} canPreview={project.role === "studio"} />
      ) : null}
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
