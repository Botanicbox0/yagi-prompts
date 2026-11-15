import { brandContext } from "@/components/brand-workspace/context";
import { ActionForm } from "@/components/brand-workspace/action-form";
import { brandScope, membershipOf } from "@/components/brand-workspace/scope";
import { BrandUnavailable } from "@/components/brand-workspace/brand-unavailable";
import { scopedHref } from "@/lib/brands/workspace/selection";
import { CampaignWizard, type WizardFormat } from "@/components/brand-workspace/campaign-wizard";
import { ProjectIntakeWizard } from "@/components/brand-workspace/project-intake-wizard";
import { roomsOpenFor } from "@/components/brand-rooms/room/visibility";
import { brandRoomsOpen } from "@/lib/flags";
import { featureDenied, isSandboxedClientOrganization } from "@/lib/brands/features";
import { loadPromptCatalog } from "@/lib/prompts/catalog";
import { StudioPrep } from "@/components/brand-workspace/studio-prep";
import { intakeBriefEn, intakeBriefKo } from "@/messages/intake-brief";
export default async function NewBrandProject({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[]; track?: string | string[] }>;
}) {
  const [{ organizationId, track }, { sql, viewer, verifiedEmail, b, dict, locale }] = await Promise.all([searchParams, brandContext()]);
  if (!sql) return <p role="alert">{b.unavailable}</p>;
  const { selection, choice, choices } = await brandScope({ sql, verifiedEmail }, viewer, organizationId);
  if (selection.state === "unavailable") return <BrandUnavailable b={b} />;
  // A brief goes to the SELECTED brand, and only when that brand's role may send one.
  const workspace = { organizations: membershipOf(choice) };
  const organizations = workspace.organizations.filter(
    (o) => o.role !== "viewer",
  );
  const back = scopedHref("/brand", choice);
  // A DB admin looking at a brand they are not a member of prepares the campaign as the studio
  // (hidden from the client), through the brand host's studio door. Team-domain readers stay read-only.
  const studioPrep = viewer.isAdmin && (choice?.role === "studio" || choices.length === 0);
  // Step 1 shows the public video formats as the catalogue does (docs/PLATFORM-2.0.md §16.3): media and title only.
  // A catalogue that cannot be read, or a brand whose policy closes generative media, leaves the custom request only.
  const generativeClosed = Boolean(
    choice && (isSandboxedClientOrganization(choice) || featureDenied(choice.denied, "generative_media")),
  );
  const useIntakeBrief = Boolean(choice && roomsOpenFor(choice, brandRoomsOpen()));
  const selfStudioClosed = Boolean(choice && featureDenied(choice.denied, "self_studio"));
  const intakeCopy = dict?.intakeBrief ?? (locale === "en" ? intakeBriefEn : intakeBriefKo);
  // In the project space (rooms open) the way back is to 프로젝트, not the campaign list.
  const backLabel = useIntakeBrief ? (dict?.roomsShell?.room.back ?? b.back) : b.back;
  const formats: WizardFormat[] = organizations.length === 0 || generativeClosed || useIntakeBrief ? [] : (await loadPromptCatalog(sql).catch(() => ({ video: [] as Awaited<ReturnType<typeof loadPromptCatalog>>["video"] }))).video.map((card) => ({
    slug: card.slug, title: locale === "ko" && card.titleKo ? card.titleKo : card.title, source: card.source,
    authorHandle: card.source === "community" ? card.authorHandle : null, poster: card.poster, video: card.video,
  }));
  return (
    <div data-brand-new-project>
      <div className="bw-heading">
        <div>
          <a href={back}>← {backLabel}</a>
          <h1>{studioPrep ? b.studioPrep.title : organizations.length ? (useIntakeBrief ? intakeCopy.title : b.wizard.title) : b.newProject}</h1>
          <p>{studioPrep ? b.studioPrep.intro : organizations.length ? (useIntakeBrief ? intakeCopy.intro : b.wizard.intro) : b.emptyBody}</p>
        </div>
      </div>
      {studioPrep ? (
        <StudioPrep b={b} organizations={choices.filter((c) => c.role !== "guest").map(({ id, name }) => ({ id, name }))} selectedId={choice?.id ?? null} />
      ) : !choices.some((c) => c.role !== "guest") ? (
        // No workspace yet: create it here and come straight back, instead of bouncing via /brand
        // (which, for campaign-only invitees, shows their campaigns and no creation form).
        <section className="bw-panel" data-brand-new-project-setup>
          <h2>{b.needOrganization}</h2>
          <p className="bw-note">{b.organizationHint}</p>
          <ActionForm
            operation="organization.create"
            b={b}
            submit={b.createOrganization}
            redirectTo="/brand/projects/new"
          >
            <label>
              {b.organization}
              <input name="name" minLength={2} maxLength={100} required autoComplete="organization" />
            </label>
          </ActionForm>
        </section>
      ) : organizations.length === 0 ? (
        <section className="bw-empty" data-brand-new-project-read-only>
          <p>{choice?.role === "guest" ? b.access.sharedOnly : choice?.role === "studio" ? b.access.staffReadOnly : b.access.viewerCannotRequest}</p>
          <a href={back} className="bw-button">
            {backLabel}
          </a>
        </section>
      ) : useIntakeBrief ? (
        <ProjectIntakeWizard
          copy={intakeCopy}
          organizations={organizations.map(({ id, name }) => ({ id, name }))}
          initialTrack={typeof track === "string" ? track : undefined}
          selfStudioClosed={selfStudioClosed}
        />
      ) : (
        <CampaignWizard
          b={b}
          locale={locale}
          organizations={organizations.map(({ id, name }) => ({ id, name }))}
          formats={formats}
          generativeClosed={generativeClosed}
          initialTrack={typeof track === "string" ? track : undefined}
        />
      )}
    </div>
  );
}
