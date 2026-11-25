import type { Metadata } from "next";
import { BrandAssetHub } from "@/components/brand-studio/asset-hub";
import { brandContext } from "@/components/brand-workspace/context";
import { loadBrandWorkspace } from "@/lib/brands/workspace/service";
import { WorkspacePreview } from "@/components/brand-workspace/preview";
import { brandScope } from "@/components/brand-workspace/scope";
import { BrandUnavailable } from "@/components/brand-workspace/brand-unavailable";
import { StaffNotice } from "@/components/brand-workspace/staff-notice";
import { loadAssetProjectLinks } from "@/lib/brand-studio/asset-projects";
import { brandProjectSpineOpen, memberSeesBrandProjects } from "@/lib/brand-studio/brand-projects";
import { studioRuntimeDeps } from "@/lib/brand-studio/runtime";
import { loadStudioState } from "@/lib/brand-studio/service";
import { assetHubVisible, studioV2Visible } from "@/lib/brand-studio/visibility";
import { scopedHref, sectionVisibility } from "@/lib/brands/workspace/selection";
import { brandStudioV2Open } from "@/lib/flags";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}): Promise<Metadata> {
  if (!brandStudioV2Open()) return {};
  const [{ organizationId }, { sql, viewer, verifiedEmail, dict }] = await Promise.all([searchParams, brandContext()]);
  if (!sql) return {};
  const { choice } = await brandScope({ sql, verifiedEmail }, viewer, organizationId);
  if (!choice || choice.role === "guest" || !assetHubVisible(choice, true)) return {};
  return { title: dict.studioLibrary.label };
}

export default async function ContentLibrary({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  const [{ organizationId }, { sql, viewer, verifiedEmail, b, dict, locale }] = await Promise.all([searchParams, brandContext()]);
  if (!sql) return <p role="alert">{b.unavailable}</p>;
  const { selection, choice } = await brandScope({ sql, verifiedEmail }, viewer, organizationId);
  if (selection.state === "unavailable") return <BrandUnavailable b={b} />;
  // The selected brand's content only; with no brand at all there is nothing to list.
  const w = choice
      ? await loadBrandWorkspace({ sql, verifiedEmail }, viewer, { includeAllContent: true, organizationId: choice.id })
      : { organizations: [], projects: [] },
    contents = w.projects.flatMap((p) =>
      (p.overview?.contents ?? []).map((c) => ({ p, c })),
    ),
    approvedCount = contents.filter(({ c }) => c.decision === "approved").length,
    pendingCount = contents.filter(({ c }) => c.decision === "pending").length,
    changesCount = contents.filter(({ c }) => c.decision === "changes_requested").length,
    studioVisible = Boolean(choice && sectionVisibility(choice).studio),
    hubVisible = Boolean(choice && choice.role !== "guest" && brandStudioV2Open() && assetHubVisible(choice, true)),
    canOpenStudio = Boolean(choice && studioVisible && brandStudioV2Open() && studioV2Visible(choice, true)),
    isKo = locale !== "en";

  if (choice && hubVisible) {
    const canTransact = typeof (sql as { transaction?: unknown }).transaction === "function";
    // The studio state and the project links are read side by side; both pass the same seat check
    // (membership, the sandbox hardline, the feature policy), and the links are ids only.
    const [loaded, links] = canTransact
      ? await Promise.all([
          loadStudioState(await studioRuntimeDeps(sql), viewer, choice.id).catch(() => null),
          loadAssetProjectLinks({ sql }, viewer, choice.id).catch(() => null),
        ])
      : [null, null];
    const initialState = loaded && loaded.ok ? loaded : null;
    const projectLinks = initialState && links && links.ok ? { self: links.self, team: links.team } : null;
    const deliverables = contents.map(({ p, c }) => ({
      id: c.id,
      projectId: p.id,
      projectTitle: p.title,
      title: c.title,
      kind: c.mime?.startsWith("image/") ? ("image" as const) : c.mime?.startsWith("video/") ? ("video" as const) : ("file" as const),
      url: c.mediaUrl,
      createdAt: c.createdAt,
    }));
    const deliverablesGrid = contents.length ? (
      <div className="bw-content-grid">
        {contents.map(({ p, c }) => (
          <a className="bw-content-card" key={c.id} href={`/brand/projects/${p.id}#review`}>
            <WorkspacePreview content={c} b={b} title={p.organizationName} />
            <div>
              <span className="bw-status" data-state={c.decision}>
                {b.decisionStates[c.decision]}
              </span>
              <h3>{c.title}</h3>
              <p>{p.title}</p>
            </div>
          </a>
        ))}
      </div>
    ) : null;

    const spineOpen =
      memberSeesBrandProjects({ staff: choice.role === "studio", role: choice.role }) &&
      (await brandProjectSpineOpen(sql, choice.id));

    return (
      <>
        {choice.role === "studio" && <StaffNotice b={b} />}
        <BrandAssetHub
          organizationId={choice.id}
          studioCopy={dict.brandStudio}
          libraryCopy={dict.studioLibrary}
          initialState={initialState}
          deliverableCount={contents.length}
          deliverablesNode={deliverablesGrid}
          projectLinks={projectLinks}
          deliverables={deliverables}
          canOpenStudio={canOpenStudio}
          {...(spineOpen ? { useFilmParam: true } : {})}
        />
      </>
    );
  }

  return (
    <div data-brand-library>
      <div className="bw-heading">
        <div>
          <div className="bw-title">
            <h1>{b.managed.library}</h1>
            {contents.length > 0 && <span className="bw-count-chip" data-library-total>{contents.length}</span>}
          </div>
          <p>{b.managed.libraryHint}</p>
        </div>
        {studioVisible && (
          <a href={scopedHref("/brand/studio", choice)} className="bw-button bw-primary">
            {isKo ? "스튜디오 열기 →" : "Open Studio →"}
          </a>
        )}
      </div>
      {choice?.role === "studio" && <StaffNotice b={b} />}
      <div className="bw-sota-library-bar" data-library-summary-bar>
        <div className="bw-sota-library-pills">
          <span className="bw-sota-stat-pill" data-state="all">
            <span>{isKo ? "전체 에셋" : "All Assets"}</span>
            <strong>{contents.length}</strong>
          </span>
          <span className="bw-sota-stat-pill" data-state="approved">
            <span>{b.decisionStates.approved}</span>
            <strong>{approvedCount}</strong>
          </span>
          <span className="bw-sota-stat-pill" data-state="pending">
            <span>{b.decisionStates.pending}</span>
            <strong>{pendingCount}</strong>
          </span>
          <span className="bw-sota-stat-pill" data-state="changes_requested">
            <span>{b.decisionStates.changes_requested}</span>
            <strong>{changesCount}</strong>
          </span>
        </div>
        {/* Studio-made videos live in the studio history. Same rule as the sidebar: campaign-only guests have no studio. */}
        {studioVisible && (
          <p className="bw-note" data-library-studio-link style={{ margin: 0 }}>
            {b.managed.libraryStudio}{" "}
            <a href={scopedHref("/brand/studio#studio-history", choice)}>{b.managed.libraryStudioLink} →</a>
          </p>
        )}
      </div>
      {contents.length ? (
        <div className="bw-content-grid">
          {contents.map(({ p, c }) => (
            <a
              className="bw-content-card"
              key={c.id}
              href={`/brand/projects/${p.id}#review`}
            >
              <WorkspacePreview content={c} b={b} title={p.organizationName} />
              <div>
                <span className="bw-status" data-state={c.decision}>
                  {b.decisionStates[c.decision]}
                </span>
                <h3>{c.title}</h3>
                <p>{p.title}</p>
              </div>
            </a>
          ))}
        </div>
      ) : (
        <p className="bw-empty">{b.managed.libraryEmpty}</p>
      )}
    </div>
  );
}
