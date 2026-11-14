"use client";
/**
 * `@` Multimodal Reference Autocomplete for the Studio v4 Floating Capsule Dock.
 *
 * Typing `@` (e.g. `@`, `@im`, `@제품`, `@vid`, `@1`) in the prompt `<textarea>` opens a crisp
 * monochrome popover right above the prompt bar:
 *   1. Attached references (`tray`): square thumbnail, `@image1` / `@video1` / `@audio1` mono badge,
 *      item name, and role pill (`제품`, `인물`, `배경`…). Selecting inserts `@imageN ` (always with a
 *      trailing space).
 *   2. Add directly from assets (`recentOutputs` + `availableAssets`): unattached images, videos
 *      (in video mode), and audio. Selecting attaches the item to `tray` AND inserts its newly
 *      assigned `@imageN ` / `@videoN ` / `@audioN ` token in a single click or `Enter` / `Tab`.
 */
import { STUDIO_LIMITS, type StudioAssetKind, type StudioAssetRole, type StudioAssetView } from "@/lib/brand-studio/contracts";
import type { StudioMedium } from "@/lib/brand-studio/models";
import { studioVideoEn, studioVideoKo, type StudioVideoCopy } from "@/messages/studio-video";
import type { StudioCopy } from "./copy";
import { StudioIcon } from "./icons";
import { trayItemFromAsset, trayNumbers, type TrayItem } from "./refs";
import w from "./video/video-workspace.module.css";

export function virtualMentionTag(kind: StudioAssetKind, ordinal: number): string {
  return `@${kind}${ordinal}`;
}

export function trayVirtualTags(items: readonly Pick<TrayItem, "kind">[]): string[] {
  const nums = trayNumbers(items);
  return items.map((item, idx) => virtualMentionTag(item.kind, nums[idx] ?? 1));
}

export interface MentionTrigger {
  active: boolean;
  query: string;
  atIndex: number;
}

const TRIGGER_RE = /(?:^|[\s([{"'“‘،,.;:!?])@([^\s@]{0,24})$/;

export function detectMentionTrigger(text: string, cursor: number): MentionTrigger {
  const safeCursor = Math.max(0, Math.min(cursor, text.length));
  const head = text.slice(0, safeCursor);
  const match = TRIGGER_RE.exec(head);
  if (!match) return { active: false, query: "", atIndex: -1 };
  const query = match[1] ?? "";
  const atIndex = head.length - query.length - 1;
  return { active: true, query, atIndex };
}

/**
 * Replaces the active `@query` slice before `cursor` with `${token} ` — ALWAYS preserving a trailing
 * space so Seedance's tokenizer never glues `@image2` onto the next word.
 */
export function applyMentionInsertion(
  text: string,
  cursor: number,
  atIndex: number,
  token: string,
): { text: string; nextCursor: number } {
  const safeCursor = Math.max(0, Math.min(cursor, text.length));
  const start = atIndex >= 0 && atIndex <= safeCursor ? atIndex : safeCursor;
  const before = text.slice(0, start);
  const after = text.slice(safeCursor).replace(/^ /, "");
  const cleanToken = token.trim();
  const inserted = `${cleanToken} `;
  return {
    text: `${before}${inserted}${after}`,
    nextCursor: before.length + inserted.length,
  };
}

export function stepMentionIndex(current: number, delta: 1 | -1, total: number): number {
  if (total <= 0) return 0;
  return ((current + delta) % total + total) % total;
}

const KIND_KEYWORDS: Record<StudioAssetKind, readonly string[]> = {
  image: ["image", "img", "pic", "photo", "이미지", "사진", "컷"],
  video: ["video", "vid", "clip", "영상", "비디오", "클립"],
  audio: ["audio", "aud", "sound", "music", "오디오", "사운드", "소리", "음악"],
};

const ROLE_ALIASES: Record<StudioAssetRole, readonly string[]> = {
  product: ["제품", "상품", "product"],
  person: ["인물", "모델", "사람", "person"],
  place: ["장소", "배경", "공간", "scene", "place", "background"],
  style: ["스타일", "무드", "톤", "구도", "색감", "style"],
  logo: ["로고", "브랜드", "logo"],
  other: ["기타", "other"],
};

export interface AtMentionCandidate {
  id: string;
  section: "attached" | "library";
  kind: StudioAssetKind;
  /** Assigned virtual token without trailing space (`@image1`, `@video1`, `@audio1`). */
  token: string;
  name: string;
  thumbUrl: string | null;
  url: string;
  roleLabel: string | null;
  /** Present when selecting this row should also attach it into `tray`. */
  attachItem?: TrayItem;
}

function matchesQuery(query: string, haystacks: readonly (string | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase().replace(/^@/, "");
  if (!q) return true;
  return haystacks.some((entry) => entry && entry.toLowerCase().includes(q));
}

export function buildAtMentionCandidates(input: {
  query: string;
  mode: StudioMedium;
  tray: readonly TrayItem[];
  availableAssets?: readonly StudioAssetView[];
  recentOutputs?: readonly TrayItem[];
  copy: StudioCopy;
  outputBadgeLabel?: string;
  maxLibrary?: number;
}): { attached: AtMentionCandidate[]; library: AtMentionCandidate[]; flat: AtMentionCandidate[] } {
  const { query, mode, tray, availableAssets = [], recentOutputs = [], copy, outputBadgeLabel = null, maxLibrary = 12 } = input;
  const nums = trayNumbers(tray);
  const takenKeys = new Set(tray.map((item) => item.key));
  const countsByKind: Record<StudioAssetKind, number> = {
    image: tray.filter((i) => i.kind === "image").length,
    video: tray.filter((i) => i.kind === "video").length,
    audio: tray.filter((i) => i.kind === "audio").length,
  };

  const attached: AtMentionCandidate[] = [];
  tray.forEach((item, idx) => {
    const ordinal = nums[idx] ?? 1;
    const token = virtualMentionTag(item.kind, ordinal);
    const roleLabel = item.role ? copy.roles[item.role] : item.frame === "start" ? copy.tray.frameStart : item.frame === "end" ? copy.tray.frameEnd : null;
    const roleTerms = item.role ? [item.role, copy.roles[item.role], ...(ROLE_ALIASES[item.role] ?? [])] : [];
    if (
      matchesQuery(query, [
        token,
        token.slice(1),
        String(ordinal),
        item.name,
        roleLabel,
        ...KIND_KEYWORDS[item.kind],
        ...roleTerms,
      ])
    ) {
      attached.push({
        id: `attached:${item.key}`,
        section: "attached",
        kind: item.kind,
        token,
        name: item.name,
        thumbUrl: item.thumbUrl,
        url: item.url,
        roleLabel,
      });
    }
  });

  const library: AtMentionCandidate[] = [];
  const trayHasRoom = tray.length < STUDIO_LIMITS.referencesMax;

  if (trayHasRoom) {
    const allowedKind = (kind: StudioAssetKind): boolean => {
      if (mode === "image") return kind === "image";
      if (kind === "video" && countsByKind.video >= 1) return false;
      return true;
    };

    const seenAssetIds = new Set<string>();
    for (const item of tray) {
      if (item.assetId) seenAssetIds.add(item.assetId);
    }

    // 1) Recent generated outputs not yet in tray
    for (const out of recentOutputs) {
      if (library.length >= maxLibrary) break;
      if (takenKeys.has(out.key) || !allowedKind(out.kind)) continue;
      const nextOrdinal = countsByKind[out.kind] + 1;
      const token = virtualMentionTag(out.kind, nextOrdinal);
      if (matchesQuery(query, [token, token.slice(1), String(nextOrdinal), out.name, outputBadgeLabel, ...KIND_KEYWORDS[out.kind]])) {
        takenKeys.add(out.key);
        library.push({
          id: `library:${out.key}`,
          section: "library",
          kind: out.kind,
          token,
          name: out.name,
          thumbUrl: out.thumbUrl,
          url: out.url,
          roleLabel: outputBadgeLabel,
          attachItem: out,
        });
      }
    }

    // 2) Organization assets (Folders / Liked / Uploads) not yet in tray
    for (const asset of availableAssets) {
      if (library.length >= maxLibrary) break;
      const tile = trayItemFromAsset(asset);
      if (takenKeys.has(tile.key) || seenAssetIds.has(asset.id) || !allowedKind(asset.kind)) continue;
      const nextOrdinal = countsByKind[asset.kind] + 1;
      const token = virtualMentionTag(asset.kind, nextOrdinal);
      const roleLabel = asset.role ? copy.roles[asset.role] : null;
      const roleTerms = asset.role ? [asset.role, copy.roles[asset.role], ...(ROLE_ALIASES[asset.role] ?? [])] : [];
      if (
        matchesQuery(query, [
          token,
          token.slice(1),
          String(nextOrdinal),
          asset.name,
          roleLabel,
          ...asset.tags,
          ...KIND_KEYWORDS[asset.kind],
          ...roleTerms,
        ])
      ) {
        takenKeys.add(tile.key);
        seenAssetIds.add(asset.id);
        library.push({
          id: `library:${tile.key}`,
          section: "library",
          kind: asset.kind,
          token,
          name: asset.name,
          thumbUrl: asset.thumbUrl,
          url: asset.url,
          roleLabel,
          attachItem: tile,
        });
      }
    }
  }

  return { attached, library, flat: [...attached, ...library] };
}

function CandidateThumb({ item }: { item: AtMentionCandidate }) {
  if (item.thumbUrl || item.kind === "image") {
    return (
      <span className={w.atThumb} aria-hidden="true">
        <img src={item.thumbUrl ?? item.url} alt="" draggable={false} />
      </span>
    );
  }
  if (item.kind === "video") {
    return (
      <span className={w.atThumb} aria-hidden="true">
        <video src={`${item.url}#t=0.1`} muted playsInline preload="metadata" tabIndex={-1} />
      </span>
    );
  }
  return (
    <span className={w.atThumb} aria-hidden="true">
      <StudioIcon name="spark" />
    </span>
  );
}

export interface AtMentionMenuProps {
  id: string;
  attached: readonly AtMentionCandidate[];
  library: readonly AtMentionCandidate[];
  activeIndex: number;
  copy: StudioCopy;
  videoCopy?: StudioVideoCopy;
  onHighlight(index: number): void;
  onSelect(candidate: AtMentionCandidate): void;
}

export function AtMentionMenu({
  id,
  attached,
  library,
  activeIndex,
  copy,
  videoCopy,
  onHighlight,
  onSelect,
}: AtMentionMenuProps) {
  const menuCopy = (videoCopy ?? (/[가-힣]/.test(copy.dock.label) ? studioVideoKo : studioVideoEn)).remix.atMenu;
  const total = attached.length + library.length;

  return (
    <div id={id} className={w.atMenu} role="listbox" aria-label={menuCopy.label} data-studio-at-menu>
      {total === 0 ? (
        <p className={w.atEmpty} data-at-empty>
          {menuCopy.empty}
        </p>
      ) : (
        <>
          {attached.length > 0 && (
            <div className={w.atSection} data-at-section="attached">
              <p className={w.atSectionTitle}>{menuCopy.attachedSection}</p>
              <ul className={w.atList}>
                {attached.map((candidate, idx) => {
                  const active = idx === activeIndex;
                  return (
                    <li key={candidate.id} role="presentation">
                      <button
                        type="button"
                        id={`${id}-opt-${idx}`}
                        role="option"
                        aria-selected={active}
                        className={w.atOption}
                        data-active={active ? "" : undefined}
                        data-at-token={candidate.token}
                        data-at-section-item="attached"
                        onMouseEnter={() => onHighlight(idx)}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          onSelect(candidate);
                        }}
                      >
                        <CandidateThumb item={candidate} />
                        <span className={w.atMonoTag}>{candidate.token}</span>
                        <span className={w.atName}>{candidate.name}</span>
                        {candidate.roleLabel ? <span className={w.atRole}>{candidate.roleLabel}</span> : <span />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {library.length > 0 && (
            <div className={w.atSection} data-at-section="library">
              <p className={w.atSectionTitle}>{menuCopy.librarySection}</p>
              <ul className={w.atList}>
                {library.map((candidate, localIdx) => {
                  const idx = attached.length + localIdx;
                  const active = idx === activeIndex;
                  return (
                    <li key={candidate.id} role="presentation">
                      <button
                        type="button"
                        id={`${id}-opt-${idx}`}
                        role="option"
                        aria-selected={active}
                        className={w.atOption}
                        data-active={active ? "" : undefined}
                        data-at-token={candidate.token}
                        data-at-section-item="library"
                        onMouseEnter={() => onHighlight(idx)}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          onSelect(candidate);
                        }}
                      >
                        <CandidateThumb item={candidate} />
                        <span className={w.atMonoTag}>{candidate.token}</span>
                        <span className={w.atName}>{candidate.name}</span>
                        {candidate.roleLabel ? <span className={w.atRole}>{candidate.roleLabel}</span> : <span />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
