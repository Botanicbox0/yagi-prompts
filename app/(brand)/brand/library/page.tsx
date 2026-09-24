import { brandContext } from "@/components/brand-workspace/context";
import { loadBrandWorkspace } from "@/lib/brands/workspace/service";
import { WorkspacePreview } from "@/components/brand-workspace/preview";
import { brandScope } from "@/components/brand-workspace/scope";
import { BrandUnavailable } from "@/components/brand-workspace/brand-unavailable";
import { StaffNotice } from "@/components/brand-workspace/staff-notice";
import { scopedHref, sectionVisibility } from "@/lib/brands/workspace/selection";
export default async function ContentLibrary({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  const [{ organizationId }, { sql, viewer, verifiedEmail, b }] = await Promise.all([searchParams, brandContext()]);
  if (!sql) return <p role="alert">{b.unavailable}</p>;
  const { selection, choice } = await brandScope({ sql, verifiedEmail }, viewer, organizationId);
  if (selection.state === "unavailable") return <BrandUnavailable b={b} />;
  // The selected brand's content only; with no brand at all there is nothing to list.
  const w = choice
      ? await loadBrandWorkspace({ sql, verifiedEmail }, viewer, { includeAllContent: true, organizationId: choice.id })
      : { organizations: [], projects: [] },
    contents = w.projects.flatMap((p) =>
      (p.overview?.contents ?? []).map((c) => ({ p, c })),
    );
  return (
    <div data-brand-library>
      <div className="bw-heading">
        <div>
          <h1>{b.managed.library}</h1>
          <p>{b.managed.libraryHint}</p>
        </div>
      </div>
      {choice?.role === "studio" && <StaffNotice b={b} />}
      {/* Studio-made videos live in the studio history. Same rule as the sidebar: campaign-only guests have no studio. */}
      {choice && sectionVisibility(choice).studio && (
        <p className="bw-note" data-library-studio-link>
          {b.managed.libraryStudio}{" "}
          <a href={scopedHref("/brand/studio#studio-history", choice)}>{b.managed.libraryStudioLink} →</a>
        </p>
      )}
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
