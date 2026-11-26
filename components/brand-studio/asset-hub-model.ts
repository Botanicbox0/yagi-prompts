/**
 * The assets page's pure half: what one tile is, how tiles are searched and related, what a tile is
 * called on screen and which actions it offers. No React here, so tests read these directly.
 */
import { viewerItemToSendRef } from "@/components/brand-send/model";
import type { SendFileRef } from "@/lib/brand-rooms/send-contracts";
import type { StudioAssetKind, StudioAssetRole, StudioAssetView, StudioJobView, StudioOutputView } from "@/lib/brand-studio/contracts";
import type { RefSource } from "./refs";
import { imageCanvasHref, imageScreenRefHref, videoComposeClipHref, videoScreenHref } from "./studio-app";

export type HubSection = "projects" | "all" | "uploads" | "generated" | "folders" | "liked" | "deliverables";

export interface HubEntry {
  key: string;
  source: RefSource;
  origin: "upload" | "generated";
  kind: StudioAssetKind;
  url: string;
  thumbUrl: string | null;
  /** Everything the item can be found by (the file name as stored, or the whole prompt). Never drawn on a tile. */
  title: string;
  /** What a person would call it: a typed name or the prompt's first line. Null for machine-made file names. */
  label: string | null;
  /** Width over height the tile is drawn at, kept within 9:16 … 1.91:1. */
  ratio: number;
  /** False when the stored size is unknown and `ratio` is a guess the tile corrects once the media loads. */
  sized: boolean;
  /** The original's width in pixels, when stored: lets a wide tile ask for more than the thumbnail. */
  pixelWidth: number | null;
  role: StudioAssetRole | null;
  tags: readonly string[];
  prompt: string;
  seconds: number | null;
  createdAt: string;
  parentOutputId: string | null;
  jobId: string | null;
  /** The project the run that made this belongs to (`BRAND_STUDIO_PROJECTS`); null for uploads and when closed. */
  projectId: string | null;
  asset: StudioAssetView | null;
  output: StudioOutputView | null;
}

export const HUB_RATIO_MIN = 9 / 16;
export const HUB_RATIO_MAX = 1.91;

export function clampRatio(ratio: number): number {
  return Math.min(HUB_RATIO_MAX, Math.max(HUB_RATIO_MIN, ratio));
}

/** The long edge of a library thumbnail (`thumbnailWebp` in lib/brand-studio/files.ts). */
export const HUB_THUMB_SIDE = 512;

function tileRatio(kind: StudioAssetKind, width: number | null, height: number | null): Pick<HubEntry, "ratio" | "sized" | "pixelWidth"> {
  if (width && height && width > 0 && height > 0) return { ratio: clampRatio(width / height), sized: true, pixelWidth: width };
  return { ratio: kind === "video" ? 16 / 9 : kind === "audio" ? 1 : 4 / 5, sized: kind === "audio", pixelWidth: null };
}

/**
 * On a desktop-width page a tile can be drawn larger than its thumbnail (a 16:9 picture in a tall row, or
 * any picture on a dense screen). These are the two candidates the browser chooses between there; null
 * when the thumbnail is all there is or the original is no bigger. Narrow screens always get the thumbnail.
 */
export function tileSources(entry: Pick<HubEntry, "kind" | "url" | "thumbUrl" | "ratio" | "pixelWidth">): { srcSet: string; sizes: string } | null {
  if (entry.kind !== "image" || !entry.thumbUrl || !entry.pixelWidth) return null;
  const thumbWidth = Math.round(entry.ratio >= 1 ? HUB_THUMB_SIDE : HUB_THUMB_SIDE * entry.ratio);
  if (entry.pixelWidth <= thumbWidth) return null;
  return { srcSet: `${entry.thumbUrl} ${thumbWidth}w, ${entry.url} ${entry.pixelWidth}w`, sizes: `calc(22vw * ${entry.ratio.toFixed(3)})` };
}

const MEDIA_EXTENSION = /\.(jpe?g|png|webp|gif|heic|heif|avif|bmp|tiff?|mp4|mov|m4v|webm|mp3|wav|m4a|aac)$/i;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** Camera rolls, screenshots, messenger exports and names that are only digits and punctuation. */
const DEVICE_NAME =
  /^(img|dsc|dscf|dscn|pxl|mvi|vid|gopr|screenshot|screen[\s_-]?shot|screen[\s_-]?recording|kakaotalk|image|photo|video|clip|untitled|download|스크린샷|화면[\s_-]?캡처|화면[\s_-]?기록|제목[\s_-]?없음|새[\s_-]?파일)?[\s_\-.()\d]*$/i;

function machineMade(name: string): boolean {
  if (UUID.test(name) || DEVICE_NAME.test(name)) return true;
  if (/\s/.test(name)) return false;
  const letters = name.replace(/[^\p{L}\p{N}]/gu, "");
  if (/^[0-9a-f]{16,}$/i.test(letters)) return true;
  const digits = letters.replace(/\D/g, "").length;
  return letters.length >= 12 && digits / letters.length >= 0.3;
}

/**
 * The one line a tile may show: the first line of a typed name or prompt, without a media extension.
 * Export ids, hashes and camera-roll names (`hf_20261109_…`, `f03b2fe9-….mp4`, `IMG_4821.JPG`) give null,
 * so the picture speaks for itself.
 */
export function humanTitle(raw: string | null | undefined): string | null {
  const line = (raw ?? "").split(/\r?\n/).map((part) => part.trim()).find(Boolean);
  if (!line) return null;
  const base = line.replace(MEDIA_EXTENSION, "").trim();
  if (!base || machineMade(base)) return null;
  return /\s/.test(base) ? base : base.replace(/_+/g, " ").trim();
}

/**
 * A saved result shows once (spine rules R-A, the server's saved-result rule in lib/brand-studio/brand-projects.ts):
 * a library copy saved from a result (`source: 'generation'` with `sourceOutputId`, which only members' answers carry
 * while the spine is open) is left out while that result, linked back to it (`savedAssetId`), is among the runs merged
 * here; the result is the one tile. Without `sourceOutputId` (spine closed, guests, MCP) nothing is left out.
 */
function shownAsItsResult(asset: StudioAssetView, results: ReadonlyMap<string, StudioOutputView>): boolean {
  if (asset.source !== "generation" || !asset.sourceOutputId) return false;
  return results.get(asset.sourceOutputId.toLowerCase())?.savedAssetId?.toLowerCase() === asset.id.toLowerCase();
}

/** Builds unified entries from uploaded assets and ready generated studio outputs, newest first. */
export function buildHubEntries(assets: readonly StudioAssetView[], jobs: readonly StudioJobView[], fallbackGeneratedLabel: string): HubEntry[] {
  const entries: HubEntry[] = [];
  const results = new Map(jobs.flatMap((job) => job.outputs.map((output) => [output.id.toLowerCase(), output] as const)));
  for (const asset of assets) {
    if (shownAsItsResult(asset, results)) continue;
    entries.push({
      key: `a:${asset.id}`,
      source: { assetId: asset.id },
      origin: "upload",
      kind: asset.kind,
      url: asset.url,
      thumbUrl: asset.thumbUrl,
      title: asset.name,
      label: humanTitle(asset.name),
      ...tileRatio(asset.kind, asset.width, asset.height),
      role: asset.role,
      tags: asset.tags,
      prompt: "",
      seconds: asset.seconds,
      createdAt: asset.createdAt,
      parentOutputId: null,
      jobId: null,
      projectId: null,
      asset,
      output: null,
    });
  }
  for (const job of jobs) {
    for (const output of job.outputs) {
      entries.push({
        key: `o:${output.id}`,
        source: { outputId: output.id },
        origin: "generated",
        kind: output.kind,
        url: output.url,
        thumbUrl: output.thumbUrl,
        title: job.prompt.trim() || fallbackGeneratedLabel,
        label: humanTitle(job.prompt),
        ...tileRatio(output.kind, output.width, output.height),
        role: null,
        tags: [],
        prompt: job.prompt,
        seconds: output.seconds,
        createdAt: output.createdAt,
        parentOutputId: job.parentOutputId,
        jobId: job.id,
        projectId: job.projectId ?? null,
        asset: null,
        output,
      });
    }
  }
  return entries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

const STOP_WORDS = new Set(["the", "and", "with", "for", "from", "into", "that", "this", "사진", "이미지", "영상", "장면", "있는", "위에", "으로"]);

function promptTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

/** Scores relatedness (`> 0` means related) using role, shared tags, parent-output lineage, and prompt tokens. */
export function similarityScore(anchor: HubEntry, candidate: HubEntry): number {
  if (anchor.key === candidate.key) return 100;
  let score = 0;
  if (anchor.jobId && anchor.jobId === candidate.jobId) score += 8;
  if (anchor.output && candidate.parentOutputId === anchor.output.id) score += 10;
  if (candidate.output && anchor.parentOutputId === candidate.output.id) score += 10;
  if (anchor.parentOutputId && anchor.parentOutputId === candidate.parentOutputId) score += 6;
  if (anchor.role && anchor.role === candidate.role) score += 4;
  if (anchor.tags.length && candidate.tags.length) {
    const set = new Set(anchor.tags.map((t) => t.toLowerCase()));
    for (const tag of candidate.tags) if (set.has(tag.toLowerCase())) score += 5;
  }
  const anchorWords = new Set([...promptTokens(anchor.title), ...promptTokens(anchor.prompt), ...anchor.tags.map((t) => t.toLowerCase())]);
  if (anchorWords.size > 0) {
    const candWords = [...promptTokens(candidate.title), ...promptTokens(candidate.prompt), ...candidate.tags.map((t) => t.toLowerCase())];
    for (const word of candWords) if (anchorWords.has(word)) score += 2;
  }
  return score;
}

export function filterHubEntries(
  entries: readonly HubEntry[],
  opts: {
    section: HubSection;
    liked: ReadonlySet<string>;
    query: string;
    kind: "all" | StudioAssetKind;
    role: "all" | StudioAssetRole;
    similarTo: HubEntry | null;
  },
): HubEntry[] {
  const q = opts.query.trim().toLowerCase();
  const base = entries.filter((entry) => {
    if (opts.section === "uploads" && entry.origin !== "upload") return false;
    if (opts.section === "generated" && entry.origin !== "generated") return false;
    if (opts.section === "liked" && !opts.liked.has(entry.key)) return false;
    if (opts.kind !== "all" && entry.kind !== opts.kind) return false;
    if (opts.role !== "all" && entry.role !== opts.role) return false;
    if (q) {
      const hay = `${entry.title}\n${entry.prompt}\n${entry.role ?? ""}\n${entry.tags.join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  if (!opts.similarTo) return base;
  return base
    .map((entry) => ({ entry, score: similarityScore(opts.similarTo!, entry) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.entry);
}

export type HubActionKey = "useImage" | "decorate" | "makeVideo" | "compose" | "reverse" | "share" | "similar" | "project" | "projectMove" | "edit";

export interface HubAction {
  key: HubActionKey;
  label: string;
  /** Where the action goes; the ones without an address change something on this page. */
  href?: string;
  /** The `data-*` marker tests and scripts find the control by. */
  marker: `data-asset-hub-${string}` | "data-project-move";
}

export interface HubActionCopy {
  useImage: string;
  decorate: string;
  makeVideo: string;
  compose: string;
  reverse: string;
  share: string;
  similar: string;
  edit: string;
}

/**
 * What one tile can do. `main` is the single action drawn on the picture (the studio it most likely
 * goes to next); `more` is everything else, in the order the menu and the detail sheet list them.
 */
export function hubActions(
  entry: HubEntry,
  opts: {
    organizationId: string;
    canOpenStudio: boolean;
    canCreate: boolean;
    copy: HubActionCopy;
    /** The "put in a project" line for a studio result, or null while runs cannot belong to a project. */
    projectLabel?: ((entry: HubEntry) => string) | null;
    /** Spine move label (`프로젝트로 옮기기`) replacing `projectLabel` on runs & library uploads when `canMove` is true. */
    moveProjectLabel?: string | null;
    /** When 보내기 is active in asset detail, renames existing share/review actions to 외부 링크 만들기 without adding new ones. */
    externalLinkLabel?: string;
  },
): { main: HubAction | null; more: HubAction[] } {
  const { organizationId, canOpenStudio, canCreate, copy } = opts;
  let main: HubAction | null = null;
  const more: HubAction[] = [];
  if (canOpenStudio && entry.kind === "image") {
    main = { key: "useImage", label: copy.useImage, href: imageScreenRefHref(organizationId, entry.source), marker: "data-asset-hub-use-image" };
    more.push(
      { key: "decorate", label: copy.decorate, href: imageCanvasHref(organizationId, entry.source), marker: "data-asset-hub-open-canvas" },
      { key: "makeVideo", label: copy.makeVideo, href: videoScreenHref(organizationId, entry.source), marker: "data-asset-hub-use-video" },
    );
  }
  if (canOpenStudio && entry.kind === "video") {
    main = { key: "compose", label: copy.compose, href: videoComposeClipHref(organizationId, entry.source), marker: "data-asset-hub-open-compose" };
    if (entry.asset) {
      const params = `organizationId=${encodeURIComponent(organizationId)}&start=reverse&asset=${encodeURIComponent(entry.asset.id)}`;
      more.push({ key: "reverse", label: copy.reverse, href: `/brand/studio/video?${params}`, marker: "data-asset-hub-reverse" });
    }
  }
  if (canOpenStudio && canCreate && (entry.kind === "image" || entry.kind === "video")) {
    more.push({ key: "share", label: opts.externalLinkLabel ?? copy.share, marker: "data-asset-hub-share-review" });
  }
  more.push({ key: "similar", label: copy.similar, marker: "data-asset-hub-similar" });
  if (opts.moveProjectLabel && (entry.jobId || entry.asset)) {
    more.push({ key: "projectMove", label: opts.moveProjectLabel, marker: "data-project-move" });
  } else if (opts.projectLabel && canOpenStudio && canCreate && entry.jobId) {
    more.push({ key: "project", label: opts.projectLabel(entry), marker: "data-asset-hub-project-assign" });
  }
  if (canCreate && entry.asset) more.push({ key: "edit", label: copy.edit, marker: "data-asset-hub-edit" });
  return { main, more };
}

/* ------------------------------------------------------------ by project */

/** One piece of work and the ids of the library files and studio results linked to it (server-derived). */
export interface HubProjectLink {
  id: string;
  title: string;
  updatedAt: string;
  assetIds: readonly string[];
  outputIds: readonly string[];
}

export interface HubProjectLinks {
  /** Video projects the team made themselves. */
  self: readonly HubProjectLink[];
  /** Projects done with the YAGI team (files reviewed in the project's room). */
  team: readonly HubProjectLink[];
}

/** A campaign deliverable: it lives in its project's review, so its tile is a link there. */
export interface HubDeliverable {
  id: string;
  projectId: string;
  projectTitle: string;
  title: string;
  kind: "image" | "video" | "file";
  url: string | null;
  createdAt: string;
}

export interface HubProjectGroup {
  key: string;
  origin: "self" | "team";
  id: string;
  title: string;
  entries: HubEntry[];
  deliverables: HubDeliverable[];
  /** Newest thing in the group, for ordering. */
  latest: string;
}

export interface HubProjectView {
  /** The brand's standing material: uploads given a role (logo, product, person …). Not a project. */
  standing: HubEntry[];
  groups: HubProjectGroup[];
  /** Everything that is in no project and is not standing material. */
  loose: HubEntry[];
}

export const groupCount = (group: Pick<HubProjectGroup, "entries" | "deliverables">): number => group.entries.length + group.deliverables.length;

/**
 * Sorts what the page already shows into projects. Only `entries` are ever placed, so a deleted file, a
 * deleted run or an internal fill run (none of which reach `entries`) cannot appear through a project.
 *
 * - A file linked to two projects appears in both; a file in any project never appears in `loose`.
 * - A result and the library copy saved from it travel together (either one being linked places both).
 * - A project with nothing to show is left out; `standing` is role-tagged uploads, whatever uses them.
 */
export function groupByProject(entries: readonly HubEntry[], links: HubProjectLinks | null | undefined, deliverables: readonly HubDeliverable[] = []): HubProjectView {
  const byAsset = new Map<string, HubEntry>();
  const byOutput = new Map<string, HubEntry>();
  const savedCopy = new Map<string, string>(); // output id -> asset id
  const savedFrom = new Map<string, string>(); // asset id -> output id
  for (const entry of entries) {
    if (entry.asset) byAsset.set(entry.asset.id, entry);
    if (entry.output) {
      byOutput.set(entry.output.id, entry);
      if (entry.output.savedAssetId) {
        savedCopy.set(entry.output.id, entry.output.savedAssetId);
        savedFrom.set(entry.output.savedAssetId, entry.output.id);
      }
    }
  }
  const order = new Map(entries.map((entry, index) => [entry.key, index]));
  const placed = new Set<string>();
  const inProject = new Map<string, HubEntry[]>();
  for (const entry of entries) {
    if (!entry.projectId) continue;
    const list = inProject.get(entry.projectId);
    if (list) list.push(entry);
    else inProject.set(entry.projectId, [entry]);
  }

  const members = (link: HubProjectLink): HubEntry[] => {
    const found = new Map<string, HubEntry>();
    const add = (entry: HubEntry | undefined) => {
      if (entry) found.set(entry.key, entry);
    };
    for (const id of link.assetIds) {
      add(byAsset.get(id));
      const source = savedFrom.get(id);
      if (source) add(byOutput.get(source));
    }
    for (const id of link.outputIds) {
      add(byOutput.get(id));
      const copy = savedCopy.get(id);
      if (copy) add(byAsset.get(copy));
    }
    // Results whose run was put in this project (it has to be a project the page knows: a deleted one names nothing).
    for (const entry of inProject.get(link.id) ?? []) {
      add(entry);
      const copy = entry.output ? savedCopy.get(entry.output.id) : undefined;
      if (copy) add(byAsset.get(copy));
    }
    return [...found.values()].sort((a, b) => order.get(a.key)! - order.get(b.key)!);
  };
  const newest = (list: readonly { createdAt: string }[], fallback: string): string => list.reduce((max, item) => (item.createdAt > max ? item.createdAt : max), list.length ? "" : fallback);

  const groups: HubProjectGroup[] = [];
  for (const link of links?.self ?? []) {
    const found = members(link);
    if (!found.length) continue;
    for (const entry of found) placed.add(entry.key);
    groups.push({ key: `self:${link.id}`, origin: "self", id: link.id, title: link.title, entries: found, deliverables: [], latest: newest(found, link.updatedAt) });
  }

  const team = new Map<string, { title: string; updatedAt: string; link: HubProjectLink | null; deliverables: HubDeliverable[] }>();
  for (const link of links?.team ?? []) team.set(link.id, { title: link.title, updatedAt: link.updatedAt, link, deliverables: [] });
  for (const item of deliverables) {
    const row = team.get(item.projectId);
    if (row) row.deliverables.push(item);
    else team.set(item.projectId, { title: item.projectTitle, updatedAt: item.createdAt, link: null, deliverables: [item] });
  }
  for (const [id, row] of team) {
    const found = row.link ? members(row.link) : [];
    if (!found.length && !row.deliverables.length) continue;
    for (const entry of found) placed.add(entry.key);
    groups.push({ key: `team:${id}`, origin: "team", id, title: row.title, entries: found, deliverables: row.deliverables, latest: newest([...found, ...row.deliverables], row.updatedAt) });
  }
  groups.sort((a, b) => (a.latest < b.latest ? 1 : a.latest > b.latest ? -1 : a.key < b.key ? -1 : 1));

  const standing = entries.filter((entry) => entry.origin === "upload" && entry.role !== null);
  const kept = new Set(standing.map((entry) => entry.key));
  const loose = entries.filter((entry) => !placed.has(entry.key) && !kept.has(entry.key));
  return { standing, groups, loose };
}

export interface HubViewFilter {
  liked: ReadonlySet<string>;
  query: string;
  kind: "all" | StudioAssetKind;
  role: "all" | StudioAssetRole;
}

/** The by-project view under the page's search and filters. A group with nothing left is dropped. */
export function filterProjectView(view: HubProjectView, filter: HubViewFilter): HubProjectView {
  const pass = (list: readonly HubEntry[]) => filterHubEntries(list, { section: "all", similarTo: null, ...filter });
  const q = filter.query.trim().toLowerCase();
  const keep = (item: HubDeliverable) =>
    filter.role === "all" && (filter.kind === "all" || filter.kind === item.kind) && (!q || `${item.title}\n${item.projectTitle}`.toLowerCase().includes(q));
  return {
    standing: pass(view.standing),
    groups: view.groups
      .map((group) => {
        // A search that names the project keeps the whole project.
        const named = Boolean(q) && group.title.toLowerCase().includes(q);
        const unsearched = named ? { ...filter, query: "" } : filter;
        return {
          ...group,
          entries: filterHubEntries(group.entries, { section: "all", similarTo: null, ...unsearched }),
          deliverables: group.deliverables.filter(named ? (item) => filter.role === "all" && (filter.kind === "all" || filter.kind === item.kind) : keep),
        };
      })
      .filter((group) => groupCount(group) > 0),
    loose: pass(view.loose),
  };
}

/* ------------------------------------------------------- moving a run */

/**
 * The runs that move together when one is put in a project: up to the first run of the chain, then down
 * through everything made from its results (later versions, the 1080p finish, partial edits). The server
 * decides for real (`job.assign_project`); this is the same walk over what the page holds, so the menu can
 * say how many pictures will move before anything is sent.
 */
export function jobFamily(jobs: readonly Pick<StudioJobView, "id" | "parentOutputId" | "outputs">[], jobId: string): string[] {
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const makerOf = new Map<string, string>();
  for (const job of jobs) for (const output of job.outputs) makerOf.set(output.id, job.id);
  let top = jobId;
  for (let guard = 0; guard < 64; guard += 1) {
    const parent = byId.get(top)?.parentOutputId;
    const maker = parent ? makerOf.get(parent) : undefined;
    if (!maker || maker === top) break;
    top = maker;
  }
  const family = new Set<string>([top]);
  const queue = [top];
  while (queue.length) {
    const current = queue.shift()!;
    const made = new Set(byId.get(current)?.outputs.map((output) => output.id));
    for (const job of jobs) {
      if (!family.has(job.id) && job.parentOutputId && made.has(job.parentOutputId)) {
        family.add(job.id);
        queue.push(job.id);
      }
    }
  }
  return [...family];
}

/** How many results on the page move with this run (itself included). */
export function familySize(jobs: readonly Pick<StudioJobView, "id" | "parentOutputId" | "outputs">[], jobId: string): number {
  const family = new Set(jobFamily(jobs, jobId));
  return jobs.reduce((sum, job) => (family.has(job.id) ? sum + job.outputs.length : sum), 0);
}

/**
 * Resolves the active entry for `detail` or `similarAnchor` (Fix 2-2).
 * Without `spine`, a missing key means the file was deleted so returns `null` (closes detail / clears similar bar).
 * With `spine`, paged `ScopeView` entries live outside `entries`, so keeps `stored` until invalidated by deletion.
 */
export function resolveHubEntry(
  entries: readonly HubEntry[],
  key: string | null,
  stored: HubEntry | null,
  spineOn: boolean,
): HubEntry | null {
  if (!key) return null;
  return entries.find((e) => e.key === key) ?? (spineOn && stored?.key === key ? stored : null);
}

/** Whether a cached `detailEntry` / `similarEntry` belongs to a deleted library asset (Fix 2-5). */
export function entryMatchesAsset(entry: HubEntry | null, assetId: string): boolean {
  return entry?.asset?.id === assetId;
}

/**
 * Maps an assets-hub detail entry to its 보내기 contract `SendFileRef`, or `null` for entries without
 * a valid asset reference, outputs whose run is not loaded, or unsendable jobs (`fill`, `compose-1080p`).
 */
export function hubEntryToSendRef(
  entry: Pick<HubEntry, "asset" | "output"> | null | undefined,
  job?: Pick<StudioJobView, "kind" | "model" | "purpose"> | null,
): SendFileRef | null {
  if (!entry) return null;
  if (entry.asset) return viewerItemToSendRef({ type: "asset", asset: entry.asset });
  if (entry.output && job) return viewerItemToSendRef({ type: "output", output: entry.output, job });
  return null;
}

export function findHubEntryJob(
  entry: Pick<HubEntry, "jobId"> | null | undefined,
  ...jobLists: Array<readonly StudioJobView[] | undefined | null>
): StudioJobView | null {
  const jobId = entry?.jobId;
  if (!jobId) return null;
  for (const list of jobLists) {
    const hit = list?.find((j) => j.id === jobId);
    if (hit) return hit;
  }
  return null;
}
