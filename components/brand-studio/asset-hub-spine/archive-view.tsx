"use client";
/**
 * Full-project archive view (`/brand/library?view=archive`, spine rules R-B).
 * Reuses `formatGroupCounts`, `LazyVideoCover`, `RailIcon`, `next/link`, and studio styling tokens.
 * Search submits cleanly via the form (no timers) with stale-response dropping via `reqSeqRef`.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { StudioBrandProjectArchive } from "@/lib/brand-studio/contracts";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { StudioApi } from "../api";
import type { HubDeliverable } from "../asset-hub-model";
import s from "../asset-hub.module.css";
import type { StudioLocale } from "../copy";
import { RailIcon } from "../rail/icons";
import { fill } from "../rail/text";
import {
  archiveBodyKind,
  archiveReducer,
  archiveRowCanOpenStudio,
  archiveRowCover,
  archiveRowFilesHref,
  archiveRowStudioHref,
  formatArchiveActivityDate,
  initialArchiveState,
  isFinishedArchiveRow,
  shouldReadArchiveFirstPage,
  type ArchiveFirstLoadCursor,
} from "./archive-model";
import sp from "./asset-hub-spine.module.css";
import { LazyVideoCover } from "./lazy-video-cover";
import {
  deliverableCountsByProject,
  formatGroupCounts,
  libraryByProjectHref,
  type GroupCountLabels,
} from "./model";

export interface ArchiveViewProps {
  organizationId: string;
  locale: StudioLocale;
  libraryCopy: Dictionary["studioLibrary"];
  projectSpineCopy: Dictionary["projectSpine"];
  canOpenStudio: boolean;
  canCreate: boolean;
  deliverables?: readonly HubDeliverable[];
  api: StudioApi;
  refreshNonce?: number;
  initialArchive?: StudioBrandProjectArchive | null;
  initialQuery?: string;
}

const EMPTY_DELIVERABLES: readonly HubDeliverable[] = Object.freeze([]);

export function ArchiveView({
  organizationId,
  locale,
  libraryCopy,
  projectSpineCopy,
  canOpenStudio,
  canCreate,
  deliverables = EMPTY_DELIVERABLES,
  api,
  refreshNonce = 0,
  initialArchive = null,
  initialQuery = "",
}: ArchiveViewProps) {
  const h = libraryCopy.hub;
  const spineCopy = h.spine;
  const normalizedInitialQuery = initialQuery.trim();

  const [searchInput, setSearchInput] = useState(initialQuery);
  const [committedQuery, setCommittedQuery] = useState(normalizedInitialQuery);
  const [archiveState, dispatch] = useReducer(archiveReducer, initialArchive, initialArchiveState);

  const apiRef = useRef(api);
  apiRef.current = api;
  const reqSeqRef = useRef(0);
  const committedQueryRef = useRef(committedQuery);
  committedQueryRef.current = committedQuery;

  const lastLoadCursorRef = useRef<ArchiveFirstLoadCursor | null>(
    initialArchive ? { organizationId, query: normalizedInitialQuery, refreshNonce } : null,
  );

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

  const deliverableCounts = useMemo(() => deliverableCountsByProject(deliverables), [deliverables]);
  const byProjectHref = useMemo(() => libraryByProjectHref(organizationId), [organizationId]);

  const fetchFirstPage = useCallback((targetQuery: string) => {
    const seq = ++reqSeqRef.current;
    dispatch({ type: "start_first" });
    void apiRef.current
      .loadBrandProjectArchive(targetQuery ? { query: targetQuery } : undefined)
      .then((res) => {
        if (seq !== reqSeqRef.current) return;
        if (!res.ok) {
          dispatch({ type: "failed", kind: "first", code: res.code });
          return;
        }
        dispatch({ type: "loaded", mode: "replace", page: res });
      })
      .catch(() => {
        if (seq !== reqSeqRef.current) return;
        dispatch({ type: "failed", kind: "first", code: "failed" });
      });
  }, []);

  useEffect(() => {
    const nextCursor: ArchiveFirstLoadCursor = { organizationId, query: committedQuery, refreshNonce };
    if (!shouldReadArchiveFirstPage(lastLoadCursorRef.current, nextCursor)) return;
    lastLoadCursorRef.current = nextCursor;
    fetchFirstPage(committedQuery);
  }, [committedQuery, fetchFirstPage, organizationId, refreshNonce]);

  const submitSearch = (nextRaw: string) => {
    const nextQuery = nextRaw.trim();
    if (nextQuery !== committedQuery) {
      setCommittedQuery(nextQuery);
      return;
    }
    fetchFirstPage(nextQuery);
  };

  const clearSearch = () => {
    setSearchInput("");
    if (committedQuery !== "") {
      setCommittedQuery("");
    } else if (archiveState.phase === "failed") {
      fetchFirstPage("");
    }
  };

  const loadMore = () => {
    if (archiveState.phase === "loading" || archiveState.phase === "loading_more" || archiveState.next === null) return;
    const seq = ++reqSeqRef.current;
    const cursor = archiveState.next;
    const query = committedQueryRef.current;
    dispatch({ type: "start_more" });
    void apiRef.current
      .loadBrandProjectArchive({
        cursor,
        ...(query ? { query } : {}),
      })
      .then((res) => {
        if (seq !== reqSeqRef.current) return;
        if (!res.ok) {
          dispatch({ type: "failed", kind: "more", code: res.code });
          return;
        }
        dispatch({ type: "loaded", mode: "append", page: res });
      })
      .catch(() => {
        if (seq !== reqSeqRef.current) return;
        dispatch({ type: "failed", kind: "more", code: "failed" });
      });
  };

  const retry = () => {
    if (archiveState.failedKind === "more" && archiveState.next !== null) {
      loadMore();
      return;
    }
    fetchFirstPage(committedQueryRef.current);
  };

  const bodyKind = archiveBodyKind(archiveState, committedQuery);
  const renderNow = useMemo(() => new Date(), []);

  return (
    <section className={sp.archiveView} data-asset-hub-archive="">
      <header className={sp.archiveHeader}>
        <Link className={`${s.quietBtn} ${sp.scopeBack}`} href={byProjectHref} data-asset-hub-archive-back="">
          <RailIcon name="back" />
          {spineCopy.archiveBack}
        </Link>
        <div className={sp.archiveTitleRow}>
          <h2 className={sp.groupTitle} data-asset-hub-archive-title="">
            {spineCopy.archiveTitle}
          </h2>
          {archiveState.phase !== "loading" && archiveState.failedKind !== "first" && (
            <span className={sp.groupMeta} data-asset-hub-archive-total="">
              {fill(spineCopy.count, { n: archiveState.total })}
            </span>
          )}
        </div>
        <p className={sp.archiveHint} data-asset-hub-archive-hint="">
          {spineCopy.archiveHint}
        </p>
        <form
          className={sp.archiveSearchForm}
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            submitSearch(searchInput);
          }}
          data-asset-hub-archive-search-form=""
        >
          <div className={s.searchWrap}>
            <input
              type="search"
              className={s.searchInput}
              aria-label={spineCopy.archiveSearch}
              placeholder={spineCopy.archiveSearch}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              data-asset-hub-archive-search=""
            />
            {searchInput && (
              <button
                type="button"
                className={s.searchClear}
                aria-label={h.clearSearch}
                onClick={clearSearch}
                data-asset-hub-archive-clear=""
              >
                ×
              </button>
            )}
          </div>
        </form>
      </header>

      {bodyKind === "loading_initial" ? (
        <div className={sp.scopeLoading} aria-busy="true" data-asset-hub-archive-loading="" />
      ) : bodyKind === "failed_initial" ? (
        <div className={s.empty} role="alert" data-asset-hub-archive-error="">
          <p>{spineCopy.archiveFailed}</p>
          <button type="button" className={s.ghostBtn} onClick={retry} data-asset-hub-archive-retry="">
            {spineCopy.retry}
          </button>
        </div>
      ) : bodyKind === "empty_search" ? (
        <section className={s.empty} data-asset-hub-archive-empty="">
          <p>{spineCopy.archiveEmpty}</p>
        </section>
      ) : bodyKind === "empty_none" ? null : (
        <ul className={sp.archiveList} data-asset-hub-archive-list="">
          {archiveState.projects.map((card) => {
            const origin = card.project.origin;
            const originLabel = origin === "team" ? h.projects.team : h.projects.self;
            const finished = isFinishedArchiveRow(card);
            const cover = archiveRowCover(card.covers);
            const countsText = formatGroupCounts(
              card.counts,
              origin,
              countLabels,
              origin === "team" ? (deliverableCounts.get(card.project.id) ?? 0) : 0,
            );
            const activityIso = card.project.lastActivityAt;
            const dateText = formatArchiveActivityDate(activityIso, locale, renderNow);
            const filesHref = archiveRowFilesHref(organizationId, card.project.id);
            const studioHref = archiveRowCanOpenStudio(card, canOpenStudio, canCreate)
              ? archiveRowStudioHref(organizationId, card.project.id)
              : null;

            return (
              <li
                key={card.project.id}
                className={sp.archiveRow}
                data-asset-hub-archive-row={card.project.id}
                data-origin={origin}
                data-finished={finished ? "" : undefined}
              >
                <div className={sp.archiveThumb}>
                  {cover?.kind === "image" ? (
                    <img src={cover.src} alt="" loading="lazy" decoding="async" draggable={false} />
                  ) : cover?.kind === "video" ? (
                    <LazyVideoCover url={cover.url} className={sp.archiveThumbBlank} />
                  ) : (
                    <span className={sp.archiveThumbBlank} aria-hidden="true" />
                  )}
                </div>
                <div className={sp.archiveRowBody}>
                  <div className={sp.archiveRowTop}>
                    <span className={sp.archiveRowTitle} data-asset-hub-archive-row-title="">
                      {card.project.title}
                    </span>
                    {finished && (
                      <span className={sp.statusMark} data-asset-hub-archive-status={card.status}>
                        {spineCopy.finishedMark}
                      </span>
                    )}
                  </div>
                  <div className={sp.archiveRowMeta}>
                    <span>{originLabel}</span>
                    {countsText && (
                      <>
                        {" · "}
                        <span data-asset-hub-archive-counts="">{countsText}</span>
                      </>
                    )}
                    {dateText && (
                      <>
                        {" · "}
                        <time dateTime={activityIso} data-asset-hub-archive-date="">
                          {dateText}
                        </time>
                      </>
                    )}
                  </div>
                </div>
                <div className={sp.archiveRowActions}>
                  <Link href={filesHref} className={sp.textAction} data-asset-hub-archive-open-files={card.project.id}>
                    {spineCopy.archiveOpenFiles}
                  </Link>
                  {studioHref && (
                    <Link href={studioHref} className={sp.textAction} data-asset-hub-archive-open-studio={card.project.id}>
                      {spineCopy.archiveOpenStudio}
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {archiveState.phase === "failed" && archiveState.projects.length > 0 && (
        <div className={sp.scopeError} role="alert" data-asset-hub-archive-error="">
          <p>{spineCopy.archiveFailed}</p>
          <button type="button" className={s.ghostBtn} onClick={retry} data-asset-hub-archive-retry="">
            {spineCopy.retry}
          </button>
        </div>
      )}

      {archiveState.next !== null &&
        archiveState.failedKind !== "more" &&
        !(archiveState.phase === "loading" && archiveState.projects.length === 0) && (
          <div className={sp.pagerRow}>
            <button
              type="button"
              className={s.ghostBtn}
              disabled={archiveState.phase === "loading_more"}
              aria-busy={archiveState.phase === "loading_more" || undefined}
              onClick={loadMore}
              data-asset-hub-archive-more=""
            >
              {spineCopy.archiveMore}
            </button>
          </div>
        )}
    </section>
  );
}
