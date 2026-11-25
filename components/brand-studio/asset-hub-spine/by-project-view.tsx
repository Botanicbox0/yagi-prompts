"use client";
/**
 * The 프로젝트별 view of the regrouped assets page (§5.3).
 * Order: 브랜드 자료 line -> overview projects -> 미분류 group.
 */
import { useMemo, type ReactNode } from "react";
import type {
  StudioAssetView,
  StudioBrandProjectCover,
  StudioBrandProjectOverview,
  StudioState,
} from "@/lib/brand-studio/contracts";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { humanTitle, type HubDeliverable } from "../asset-hub-model";
import s from "../asset-hub.module.css";
import { RailIcon } from "../rail/icons";
import { clock, fill } from "../rail/text";
import sp from "./asset-hub-spine.module.css";
import { LazyVideoCover } from "./lazy-video-cover";
import {
  BRAND_MATERIALS_LINE_LIMIT,
  brandMaterialsCountsWithLogo,
  classifyLibraryEntry,
  deliverableCountsByProject,
  fallbackCovers,
  filterOverviewProjects,
  formatGroupCounts,
  groupBrandMaterialsLine,
  sumProjectCounts,
  type GroupCountLabels,
  type SpineOrgLogo,
} from "./model";

export interface ByProjectViewProps {
  overview: StudioBrandProjectOverview;
  libraryCopy: Dictionary["studioLibrary"];
  projectSpineCopy: Dictionary["projectSpine"];
  state: StudioState | null;
  deliverables: readonly HubDeliverable[];
  canMove: boolean;
  orgLogo?: SpineOrgLogo | null;
  query: string;
  emptyActions?: ReactNode;
  onOpenMaterials(): void;
  onOpenProject(projectId: string): void;
  onOpenUnfiled(): void;
  onMoveUnfiled(): void;
}

function PlayGlyph() {
  return (
    <svg className={s.glyph} viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d="M3.2 1.9v8.2a.5.5 0 0 0 .76.43l6.6-4.1a.5.5 0 0 0 0-.86l-6.6-4.1a.5.5 0 0 0-.76.43Z" />
    </svg>
  );
}

function CoverRow({
  covers,
  uploadCovers = [],
  groupLabel,
  videoLabel,
  outputSecondsById,
  extraTiles,
  onSelect,
}: {
  covers: readonly StudioBrandProjectCover[];
  uploadCovers?: readonly StudioAssetView[];
  groupLabel: string;
  videoLabel: string;
  outputSecondsById: ReadonlyMap<string, number>;
  extraTiles?: ReactNode;
  onSelect(): void;
}) {
  if (covers.length === 0 && uploadCovers.length === 0 && !extraTiles) return null;
  return (
    <ul className={sp.covers}>
      {covers.map((cover, idx) => {
        const still = cover.thumbUrl ?? (cover.kind === "image" ? cover.url : null);
        const seconds = cover.kind === "video" ? outputSecondsById.get(cover.outputId) : undefined;
        return (
          <li key={cover.outputId} className={sp.coverItem} data-kind={cover.kind}>
            <button
              type="button"
              className={sp.coverBtn}
              aria-label={`${groupLabel} ${idx + 1}`}
              onClick={onSelect}
            >
              {still ? (
                <img src={still} alt="" loading="lazy" decoding="async" draggable={false} />
              ) : cover.kind === "video" && cover.url ? (
                <LazyVideoCover url={cover.url} className={sp.coverBlank} />
              ) : (
                <span className={sp.coverBlank} aria-hidden="true" />
              )}
              {cover.kind === "video" && (
                <span className={`${s.badge} ${sp.coverBadge}`} data-asset-hub-length="">
                  <PlayGlyph />
                  {seconds != null ? clock(seconds) : videoLabel}
                </span>
              )}
            </button>
          </li>
        );
      })}
      {uploadCovers.map((asset, idx) => (
        <li key={`u:${asset.id}`} className={sp.coverItem} data-kind="image">
          <button
            type="button"
            className={sp.coverBtn}
            aria-label={`${groupLabel} ${covers.length + idx + 1}`}
            onClick={onSelect}
          >
            <img src={asset.thumbUrl ?? asset.url} alt="" loading="lazy" decoding="async" draggable={false} />
          </button>
        </li>
      ))}
      {extraTiles}
    </ul>
  );
}

export function ByProjectView({
  overview,
  libraryCopy,
  projectSpineCopy,
  state,
  deliverables,
  canMove,
  orgLogo = null,
  query,
  emptyActions,
  onOpenMaterials,
  onOpenProject,
  onOpenUnfiled,
  onMoveUnfiled,
}: ByProjectViewProps) {
  const h = libraryCopy.hub;
  const spineCopy = h.spine;

  const countLabels: GroupCountLabels = useMemo(
    () => ({
      image: h.kinds.image,
      video: h.kinds.video,
      sound: spineCopy.kindSound,
      upload: spineCopy.kindUploads,
      film: projectSpineCopy.film,
      deliverables: spineCopy.kindDeliverables,
    }),
    [h.kinds.image, h.kinds.video, projectSpineCopy.film, spineCopy.kindDeliverables, spineCopy.kindSound, spineCopy.kindUploads],
  );

  const outputSecondsById = useMemo(() => {
    const map = new Map<string, number>();
    for (const job of state?.jobs ?? []) {
      for (const out of job.outputs) {
        if (out.seconds != null) map.set(out.id, out.seconds);
      }
    }
    return map;
  }, [state?.jobs]);

  const materialsCounts = useMemo(
    () => brandMaterialsCountsWithLogo(overview.brandMaterials, Boolean(orgLogo)),
    [orgLogo, overview.brandMaterials],
  );

  const materialGroups = useMemo(() => {
    if (materialsCounts.count <= 0) return [];
    const fromState = (state?.assets ?? []).filter(
      (entry) => classifyLibraryEntry(entry).scope === "brand_materials",
    );
    const source = fromState.length > 0 ? fromState : overview.brandMaterials.covers;
    const limit = orgLogo ? BRAND_MATERIALS_LINE_LIMIT - 1 : BRAND_MATERIALS_LINE_LIMIT;
    const grouped = groupBrandMaterialsLine(source, limit);
    if (orgLogo && !grouped.some((g) => g.role === "logo")) {
      return [{ role: "logo" as const, assets: [] }, ...grouped];
    }
    return grouped;
  }, [materialsCounts.count, orgLogo, overview.brandMaterials.covers, state?.assets]);

  const deliverableCounts = useMemo(() => deliverableCountsByProject(deliverables), [deliverables]);
  const filteredProjects = useMemo(
    () => filterOverviewProjects(overview.projects, query),
    [overview.projects, query],
  );

  const showMaterials = materialsCounts.count > 0;
  const unfiledTotal = sumProjectCounts(overview.unfiled.counts);
  const showUnfiled = unfiledTotal > 0;
  const hasQuery = Boolean(query.trim());

  if (!showMaterials && overview.projects.length === 0 && !showUnfiled) {
    return (
      <section className={s.empty} data-asset-hub-empty="by_project">
        <p>{hasQuery ? libraryCopy.uploads.noMatch : h.emptyAll}</p>
        {!hasQuery && emptyActions}
      </section>
    );
  }

  return (
    <div className={sp.spine} data-asset-hub-spine="">
      {showMaterials && (
        <section className={sp.group} data-asset-hub-materials="">
          <div className={sp.groupHead}>
            <h2 className={sp.groupTitle}>{spineCopy.tabMaterials}</h2>
            <span className={sp.groupMeta}>
              {spineCopy.materialsDesc} · {fill(spineCopy.count, { n: materialsCounts.count })}
            </span>
            <div className={sp.groupActions}>
              <button
                type="button"
                className={sp.groupMoreBtn}
                aria-label={`${h.projects.seeAll} · ${spineCopy.tabMaterials}`}
                onClick={onOpenMaterials}
                data-asset-hub-materials-see-all=""
              >
                {h.projects.seeAll}
                <RailIcon name="collapse" />
              </button>
            </div>
          </div>
          {materialGroups.length > 0 && (
            <ul className={sp.materialsStrip}>
              {materialGroups.map((roleGroup) => (
                <li
                  key={roleGroup.role}
                  className={sp.materialRoleGroup}
                  data-asset-hub-materials-role={roleGroup.role}
                >
                  <span className={sp.materialRoleLabel}>{libraryCopy.roles[roleGroup.role]}</span>
                  <div className={sp.materialTiles}>
                    {roleGroup.role === "logo" && orgLogo && (
                      orgLogo.editHref ? (
                        <a
                          className={sp.orgLogoTile}
                          href={orgLogo.editHref}
                          aria-label={`${libraryCopy.roles.logo} · ${libraryCopy.uploads.edit}`}
                          data-asset-hub-org-logo=""
                        >
                          <img src={orgLogo.url} alt="" loading="lazy" decoding="async" draggable={false} />
                        </a>
                      ) : (
                        <div className={sp.orgLogoTile} data-asset-hub-org-logo="">
                          <img src={orgLogo.url} alt="" loading="lazy" decoding="async" draggable={false} />
                        </div>
                      )
                    )}
                    {roleGroup.assets.map((entry) => {
                      const still = entry.thumbUrl ?? (entry.kind === "image" ? entry.url : null);
                      const label = humanTitle(entry.name) ?? libraryCopy.roles[roleGroup.role];
                      return (
                        <button
                          key={entry.id}
                          type="button"
                          className={sp.materialTile}
                          aria-label={label}
                          onClick={onOpenMaterials}
                        >
                          {entry.kind === "audio" ? (
                            <RailIcon name="wave" />
                          ) : still ? (
                            <img src={still} alt="" loading="lazy" decoding="async" draggable={false} />
                          ) : (
                            <span className={sp.coverBlank} aria-hidden="true" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {hasQuery && filteredProjects.length === 0 ? (
        <p className={sp.groupEmpty} data-asset-hub-projects-no-match="">
          {libraryCopy.uploads.noMatch}
        </p>
      ) : (
        filteredProjects.map((group) => {
          const origin = group.project.origin;
          const originLabel = origin === "team" ? h.projects.team : h.projects.self;
          const teamDeliverables = origin === "team" ? (deliverableCounts.get(group.project.id) ?? 0) : 0;
          const countsText = formatGroupCounts(group.counts, origin, countLabels, teamDeliverables);
          const isEmpty = sumProjectCounts(group.counts) + teamDeliverables === 0;
          const uploadCovers =
            group.covers.length === 0 && !isEmpty
              ? fallbackCovers(state?.assets ?? [], group.project.id, 6)
              : [];
          const deliverableSlots = Math.max(0, 6 - group.covers.length - uploadCovers.length);
          return (
            <section
              key={group.project.id}
              className={sp.group}
              data-asset-hub-group={group.project.id}
              data-origin={origin}
            >
              <div className={sp.groupHead}>
                <h2 className={sp.groupTitle}>
                  {origin === "team" ? (
                    <a className={sp.groupTitleLink} href={`/brand/projects/${group.project.id}`}>
                      {group.project.title}
                    </a>
                  ) : (
                    group.project.title
                  )}
                </h2>
                <span className={sp.groupMeta}>
                  <span>{originLabel}</span>
                  {countsText && (
                    <>
                      {" · "}
                      <span data-asset-hub-group-counts="">{countsText}</span>
                    </>
                  )}
                </span>
                <div className={sp.groupActions}>
                  <button
                    type="button"
                    className={sp.groupMoreBtn}
                    aria-label={`${h.projects.seeAll} · ${group.project.title}`}
                    onClick={() => onOpenProject(group.project.id)}
                    data-asset-hub-group-see-all=""
                  >
                    {h.projects.seeAll}
                    <RailIcon name="collapse" />
                  </button>
                </div>
              </div>
              {isEmpty ? (
                <p className={sp.groupEmpty} data-asset-hub-group-empty="">
                  {spineCopy.groupEmpty}
                </p>
              ) : (
                <CoverRow
                  covers={group.covers}
                  uploadCovers={uploadCovers}
                  groupLabel={group.project.title}
                  videoLabel={libraryCopy.item.video}
                  outputSecondsById={outputSecondsById}
                  extraTiles={
                    origin === "team" && teamDeliverables > 0 && deliverableSlots > 0
                      ? deliverables
                          .filter((item) => item.projectId === group.project.id)
                          .slice(0, deliverableSlots)
                          .map((item) => (
                            <li key={`c:${item.id}`} className={sp.coverItem} data-kind={item.kind}>
                              <a
                                className={sp.coverBtn}
                                href={`/brand/projects/${item.projectId}#review`}
                                aria-label={`${item.title} · ${h.deliverableOpen}`}
                                data-asset-hub-deliverable=""
                              >
                                {item.kind === "image" && item.url ? (
                                  <img src={item.url} alt="" loading="lazy" decoding="async" draggable={false} />
                                ) : item.kind === "video" && item.url ? (
                                  <LazyVideoCover url={item.url} className={sp.coverBlank} />
                                ) : (
                                  <span className={sp.coverBlank} aria-hidden="true" />
                                )}
                                {item.kind === "video" && (
                                  <span className={`${s.badge} ${sp.coverBadge}`} data-asset-hub-length="">
                                    <PlayGlyph />
                                    {libraryCopy.item.video}
                                  </span>
                                )}
                              </a>
                            </li>
                          ))
                      : undefined
                  }
                  onSelect={() => onOpenProject(group.project.id)}
                />
              )}
            </section>
          );
        })
      )}

      {showUnfiled && (
        <section className={sp.group} data-asset-hub-unfiled="">
          <div className={sp.groupHead}>
            <h2 className={sp.groupTitle}>{projectSpineCopy.unfiled}</h2>
            <span className={sp.groupMeta}>
              {spineCopy.unfiledDesc} · {fill(spineCopy.count, { n: unfiledTotal })}
            </span>
            <div className={sp.groupActions}>
              {canMove && (
                <button
                  type="button"
                  className={sp.textAction}
                  onClick={onMoveUnfiled}
                  data-asset-hub-unfiled-move=""
                >
                  {projectSpineCopy.move}
                </button>
              )}
              <button
                type="button"
                className={sp.groupMoreBtn}
                aria-label={`${h.projects.seeAll} · ${projectSpineCopy.unfiled}`}
                onClick={onOpenUnfiled}
                data-asset-hub-unfiled-see-all=""
              >
                {h.projects.seeAll}
                <RailIcon name="collapse" />
              </button>
            </div>
          </div>
          <CoverRow
            covers={overview.unfiled.covers}
            groupLabel={projectSpineCopy.unfiled}
            videoLabel={libraryCopy.item.video}
            outputSecondsById={outputSecondsById}
            onSelect={onOpenUnfiled}
          />
        </section>
      )}
    </div>
  );
}
