"use client";
/**
 * "리뷰할 작업 고르기" (docs/BRAND-STUDIO-V3.md §7): the organization's recent studio results and
 * uploads, read from the studio state endpoint, then a title, then `review.create`.
 */
import "./review.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { StudioAssetView, StudioState } from "@/lib/brand-studio/contracts";
import { REVIEW_LIMITS, type ReviewCreated, type ReviewFailure } from "@/lib/brand-studio/review-contracts";
import { listedJobs } from "../store";
import { postReview } from "./api";
import { fill, reviewErrorText, type ReviewCopy } from "./stage";

interface PickItem {
  key: string;
  ref: { assetId: string } | { outputId: string };
  kind: "image" | "video";
  url: string;
  thumbUrl: string | null;
  title: string;
}

const PICK_MAX = 36;

function dayOf(iso: string, locale: "ko" | "en"): string {
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", { month: "short", day: "numeric", timeZone: "Asia/Seoul" }).format(new Date(iso));
}

export function pickItems(state: Pick<StudioState, "jobs" | "assets">, copy: ReviewCopy, locale: "ko" | "en"): { results: PickItem[]; uploads: PickItem[] } {
  const results: PickItem[] = [];
  for (const job of listedJobs(state.jobs)) {
    for (const o of job.outputs) {
      if (o.kind !== "image" && o.kind !== "video") continue;
      const prompt = job.prompt.replace(/\s+/g, " ").trim();
      const fallback = fill(o.kind === "video" ? copy.picker.videoTitle : copy.picker.imageTitle, { date: dayOf(o.createdAt, locale) });
      results.push({
        key: `o:${o.id}`,
        ref: { outputId: o.id },
        kind: o.kind,
        url: o.url,
        thumbUrl: o.thumbUrl,
        title: (prompt ? prompt.slice(0, 60) : fallback).slice(0, REVIEW_LIMITS.titleMax),
      });
    }
  }
  // Jobs arrive newest first, and so do their results.
  const uploads = state.assets
    .filter((a: StudioAssetView) => a.kind === "image" || a.kind === "video")
    .map(
      (a): PickItem => ({
        key: `a:${a.id}`,
        ref: { assetId: a.id },
        kind: a.kind as "image" | "video",
        url: a.url,
        thumbUrl: a.thumbUrl,
        title: a.name.slice(0, REVIEW_LIMITS.titleMax),
      }),
    );
  return { results: results.slice(0, PICK_MAX), uploads: uploads.slice(0, PICK_MAX) };
}

export function ReviewPicker({
  organizationId,
  copy,
  locale,
  onClose,
  onCreated,
  create,
  heading,
}: {
  organizationId: string;
  copy: ReviewCopy;
  locale: "ko" | "en";
  onClose(): void;
  onCreated(created: ReviewCreated): void;
  /** Rooms: put the chosen piece into a project or onto a stack instead of the studio review list. */
  create?: (input: { title: string; assetId?: string; outputId?: string }) => Promise<ReviewCreated | ReviewFailure>;
  /** Rooms: the dialog's own title. */
  heading?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<"loading" | "failed" | "ready">("loading");
  const [data, setData] = useState<Pick<StudioState, "jobs" | "assets"> | null>(null);
  const [tab, setTab] = useState<"results" | "uploads">("results");
  const [chosen, setChosen] = useState<PickItem | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // A native modal: the rest of the page is inert, Esc closes, focus returns to the opener.
  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open && typeof dialog.showModal === "function") dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      opener?.focus();
    };
  }, []);

  useEffect(() => {
    let live = true;
    setState("loading");
    fetch(`/api/brand-studio?${new URLSearchParams({ organizationId })}`, { credentials: "same-origin", cache: "no-store" })
      .then((r) => r.json() as Promise<StudioState | { ok: false }>)
      .then((body) => {
        if (!live) return;
        if (body && body.ok === true) {
          setData({ jobs: body.jobs, assets: body.assets });
          setState("ready");
        } else setState("failed");
      })
      .catch(() => live && setState("failed"));
    return () => {
      live = false;
    };
  }, [organizationId, attempt]);

  const items = useMemo(() => (data ? pickItems(data, copy, locale) : { results: [], uploads: [] }), [data, copy, locale]);
  useEffect(() => {
    if (state === "ready" && items.results.length === 0 && items.uploads.length > 0) setTab("uploads");
  }, [state, items]);
  const list = items[tab];

  async function start() {
    if (!chosen || !title.trim() || busy) return;
    setBusy(true);
    setError(null);
    const result = create ? await create({ title: title.trim(), ...chosen.ref }) : await postReview("review.create", { organizationId, title: title.trim(), ...chosen.ref });
    setBusy(false);
    if (!result.ok) {
      setError(reviewErrorText(copy, result.code));
      return;
    }
    onCreated(result);
  }

  return (
    <dialog ref={dialogRef} className="bsv-dialog" aria-labelledby="bsv-picker-title" onCancel={onClose} data-review-picker>
      <div className="bsv-dialog-head">
        <h2 id="bsv-picker-title" className="bsv-dialog-title">
          {heading ?? copy.picker.title}
        </h2>
        <button type="button" className="bsv-icon-btn" onClick={onClose} aria-label={copy.picker.close}>
          <svg className="bsv-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div className="bsv-seg" role="tablist" aria-label={copy.picker.title}>
        {(["results", "uploads"] as const).map((t) => (
          <button key={t} type="button" role="tab" className="bsv-seg-btn" aria-selected={tab === t} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {copy.picker[t]}
            <span className="bsv-seg-count">{items[t].length}</span>
          </button>
        ))}
      </div>
      <div className="bsv-pick-body" role="tabpanel">
        {state === "loading" ? (
          <p className="bsv-quiet" role="status">
            {copy.picker.loading}
          </p>
        ) : state === "failed" ? (
          <p className="bsv-quiet" role="alert">
            {copy.picker.failed}{" "}
            <button type="button" className="bsv-text-btn" onClick={() => setAttempt((n) => n + 1)}>
              {copy.picker.retry}
            </button>
          </p>
        ) : list.length === 0 ? (
          <p className="bsv-quiet">{copy.picker.empty}</p>
        ) : (
          <ul className="bsv-pick-grid">
            {list.map((item) => (
              <li key={item.key}>
                <button
                  type="button"
                  className="bsv-pick"
                  aria-pressed={chosen?.key === item.key}
                  aria-label={fill(copy.picker.choose, { name: item.title })}
                  data-review-pick={item.key}
                  onClick={() => {
                    setChosen(item);
                    setTitle(item.title);
                  }}
                >
                  {item.kind === "video" && !item.thumbUrl ? (
                    <video className="bsv-pick-media" src={`${item.url}#t=0.1`} preload="metadata" muted playsInline aria-hidden="true" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element -- private studio media
                    <img className="bsv-pick-media" src={item.thumbUrl ?? item.url} alt="" loading="lazy" draggable={false} />
                  )}
                  {item.kind === "video" && (
                    <span className="bsv-kind-tag" aria-hidden="true">
                      <svg className="bsv-icon" viewBox="0 0 24 24" focusable="false" data-filled="">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <form
        className="bsv-pick-foot"
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <label className="bsv-field">
          <span className="bsv-field-label">{copy.picker.nameLabel}</span>
          <input
            type="text"
            className="bsv-input"
            value={title}
            maxLength={REVIEW_LIMITS.titleMax}
            onChange={(e) => setTitle(e.target.value)}
            disabled={!chosen}
          />
        </label>
        <button type="submit" className="bsv-primary" disabled={!chosen || !title.trim() || busy}>
          {copy.picker.start}
        </button>
        <p className="bsv-error" role="alert">
          {error ?? ""}
        </p>
      </form>
    </dialog>
  );
}
