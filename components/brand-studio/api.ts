/**
 * The studio's typed client for `/api/brand-studio` (lib/brand-studio/contracts.ts).
 *
 * Every request body is a contract input type and every answer a contract response type, so a shape
 * change in contracts.ts breaks this file at compile time. Failures always come back as
 * `{ ok: false, code }` with a `StudioErrorCode`; the screen maps codes to sentences and never shows
 * a server message. Uploads: reserve -> PUT to the returned address when `direct`, otherwise POST the
 * bytes to `/api/brand-studio/assets/{id}` -> complete.
 */
import type { z } from "zod";
import {
  STUDIO_ERROR_CODES,
  STUDIO_LIMITS,
  STUDIO_UPLOAD_MIMES,
  type AssetCompleteSchema,
  type AssetFromOutputSchema,
  type AssetRefSchema,
  type AssetReserveSchema,
  type AssetUpdateSchema,
  type BrandProjectFilesInput,
  type BrandProjectFilingInput,
  type BrandProjectMoveInput,
  type CampaignHandoffSchema,
  type OutputWaveformSchema,
  type LyricsDraftSchema,
  type StudioLyricsDraft,
  type MusicDesignSchema,
  type StudioMusicDesign,
  type FilmAnalyzeSchema,
  type ImageJobGroupSchema,
  type JobAssignProjectSchema,
  type JobRefSchema,
  type OutputRefSchema,
  type PromptPreviewSchema,
  type ReviseMarkReadSchema,
  type ReviseTalkSchema,
  type RevisePlanSchema,
  type StudioAssetKind,
  type StudioAssetReserved,
  type StudioAssetRole,
  type StudioAssetSaved,
  type StudioBrandProjectCreated,
  type StudioBrandProjectFiles,
  type StudioBrandProjectList,
  type StudioBrandProjectMoved,
  type StudioBrandProjectOverview,
  type StudioDone,
  type StudioErrorCode,
  type StudioFailure,
  type StudioFilmAnalysis,
  type StudioHandoffDone,
  type StudioJobCreateSchema,
  type StudioJobCreated,
  type StudioJobGroupCreated,
  type StudioJobProjectAssigned,
  type StudioJobsPoll,
  type StudioOperation,
  type StudioPromptPreview,
  type StudioReviseMarkRead,
  type StudioRevisePlan,
  type StudioReviseTalk,
  type StudioState,
} from "@/lib/brand-studio/contracts";
import { isUnapprovedUploadReason, type UploadLimitReason } from "@/lib/brands/upload-limits-format";
import { newRequestId } from "./copy";

export const STUDIO_ENDPOINT = "/api/brand-studio";

/** Operation name -> [request input, success answer]. */
export interface StudioOps {
  "job.create": [z.input<typeof StudioJobCreateSchema> & BrandProjectFilingInput, StudioJobCreated];
  "job.create_group": [z.input<typeof ImageJobGroupSchema> & BrandProjectFilingInput, StudioJobGroupCreated];
  "job.cancel": [z.input<typeof JobRefSchema>, StudioDone];
  "prompt.enhance": [z.input<typeof PromptPreviewSchema>, StudioPromptPreview];
  "film.analyze": [z.input<typeof FilmAnalyzeSchema>, StudioFilmAnalysis];
  "revise.plan": [z.input<typeof RevisePlanSchema>, StudioRevisePlan];
  "revise.mark": [z.input<typeof ReviseMarkReadSchema>, StudioReviseMarkRead];
  "revise.talk": [z.input<typeof ReviseTalkSchema>, StudioReviseTalk];
  "asset.reserve": [z.input<typeof AssetReserveSchema> & BrandProjectFilingInput, StudioAssetReserved];
  "asset.complete": [z.input<typeof AssetCompleteSchema>, StudioAssetSaved];
  "asset.update": [z.input<typeof AssetUpdateSchema>, StudioAssetSaved];
  "asset.delete": [z.input<typeof AssetRefSchema>, StudioDone];
  "asset.from_output": [z.input<typeof AssetFromOutputSchema>, StudioAssetSaved];
  "output.delete": [z.input<typeof OutputRefSchema>, StudioDone];
  "job.delete": [z.input<typeof JobRefSchema>, StudioDone];
  "job.assign_project": [z.input<typeof JobAssignProjectSchema>, StudioJobProjectAssigned];
  "handoff.campaign": [z.input<typeof CampaignHandoffSchema>, StudioHandoffDone];
  "output.waveform": [z.input<typeof OutputWaveformSchema>, StudioDone];
  "lyrics.draft": [z.input<typeof LyricsDraftSchema>, StudioLyricsDraft];
  "music.design": [z.input<typeof MusicDesignSchema>, StudioMusicDesign];
}
// Compile-time guard: every contract operation has a row above and nothing else does.
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export const OPERATIONS_COVERED: Exact<keyof StudioOps, StudioOperation> = true;

export type ApiResult<T> = T | StudioFailure;

export function failed(code: StudioErrorCode, reason?: UploadLimitReason): StudioFailure {
  return reason ? { ok: false, code, reason } : { ok: false, code };
}

export function isFailure<T>(value: ApiResult<T>): value is StudioFailure {
  return (value as { ok?: unknown }).ok === false;
}

const STATUS_CODES: Record<number, StudioErrorCode> = {
  401: "sign_in_required",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  413: "file_too_large",
  415: "unsupported_file",
  429: "too_many_running",
};

/** A server answer as a contract value: a known code, else one derived from the HTTP status. */
async function read<T>(response: Response): Promise<ApiResult<T>> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  if (response.ok && record?.ok === true) return record as T;
  const code = record?.code;
  const reason = isUnapprovedUploadReason(record?.reason) ? record.reason : undefined;
  if (typeof code === "string" && (STUDIO_ERROR_CODES as readonly string[]).includes(code)) return failed(code as StudioErrorCode, reason);
  return failed(STATUS_CODES[response.status] ?? "failed");
}

export function uploadKind(mime: string): StudioAssetKind | null {
  for (const kind of Object.keys(STUDIO_UPLOAD_MIMES) as StudioAssetKind[])
    if ((STUDIO_UPLOAD_MIMES[kind] as readonly string[]).includes(mime)) return kind;
  return null;
}

const BYTES_MAX: Record<StudioAssetKind, number> = {
  image: STUDIO_LIMITS.imageBytesMax,
  video: STUDIO_LIMITS.videoBytesMax,
  audio: STUDIO_LIMITS.audioBytesMax,
};

/** Checked in the browser before anything is sent; the server checks again. */
export function uploadProblem(file: { type: string; size: number }): StudioErrorCode | null {
  const kind = uploadKind(file.type);
  if (!kind) return "unsupported_file";
  return file.size > BYTES_MAX[kind] ? "file_too_large" : null;
}

export interface MeasuredMedia {
  width?: number;
  height?: number;
  seconds?: number;
}

export interface UploadFile {
  name: string;
  type: string;
  size: number;
}

export interface StudioApiOptions {
  organizationId: string;
  fetch?: typeof fetch;
}

export function createStudioApi({ organizationId, fetch: fetcher = (...args) => fetch(...args) }: StudioApiOptions) {
  const json = { "Content-Type": "application/json", Accept: "application/json" };
  const query = (extra = "") => `${STUDIO_ENDPOINT}?organizationId=${encodeURIComponent(organizationId)}${extra}`;
  async function send<T>(input: RequestInfo | URL, init: RequestInit): Promise<ApiResult<T>> {
    try {
      return await read<T>(await fetcher(input, { credentials: "same-origin", cache: "no-store", ...init }));
    } catch {
      return failed("failed");
    }
  }

  function call<O extends StudioOperation>(operation: O, input: StudioOps[O][0]): Promise<ApiResult<StudioOps[O][1]>> {
    return send<StudioOps[O][1]>(STUDIO_ENDPOINT, { method: "POST", headers: json, body: JSON.stringify({ operation, input }) });
  }

  return {
    organizationId,
    loadState: (options?: { brandProject?: string }) =>
      send<StudioState>(
        query(options?.brandProject ? `&brandProject=${encodeURIComponent(options.brandProject)}` : ""),
        { method: "GET", headers: { Accept: "application/json" } },
      ),
    poll: (jobIds: readonly string[]) =>
      send<StudioJobsPoll>(query(`&jobs=${jobIds.map(encodeURIComponent).join(",")}`), {
        method: "GET",
        headers: { Accept: "application/json" },
      }),
    call,
    listBrandProjects: () =>
      send<StudioBrandProjectList>(STUDIO_ENDPOINT, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ operation: "project.list", input: { organizationId } }),
      }),
    createBrandProject: (input: { requestId: string; title: string }) =>
      send<StudioBrandProjectCreated>(STUDIO_ENDPOINT, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ operation: "project.create", input: { organizationId, ...input } }),
      }),
    moveToBrandProject: (input: Omit<BrandProjectMoveInput, "organizationId">) =>
      send<StudioBrandProjectMoved>(STUDIO_ENDPOINT, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ operation: "project.move", input: { organizationId, ...input } }),
      }),
    /** The assets page's 프로젝트별 tab: every project's counts and covers, then 미분류 and 브랜드 자료 (spine open). */
    loadBrandProjectOverview: () =>
      send<StudioBrandProjectOverview>(STUDIO_ENDPOINT, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ operation: "project.overview", input: { organizationId } }),
      }),
    /** One scope's files, one page; pass the answer's `next` as `cursor` for the following page (spine open). */
    listBrandProjectFiles: (input: Omit<BrandProjectFilesInput, "organizationId">) =>
      send<StudioBrandProjectFiles>(STUDIO_ENDPOINT, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ operation: "project.files", input: { organizationId, ...input } }),
      }),
    /** Library upload. `measure` reads width/height/length in the browser; tests pass a stub. */
    async upload(
      file: UploadFile & Blob,
      options: {
        role?: StudioAssetRole;
        requestId?: string;
        measure?: (file: Blob, kind: StudioAssetKind) => Promise<MeasuredMedia>;
        /** A source made for one run and deleted afterwards ("빈 곳 채우기"): its role is not recognised. */
        transient?: boolean;
        /** Brand project spine only: omitted for 미분류 and when spine is closed. */
        brandProjectId?: string;
      } = {},
    ): Promise<ApiResult<StudioAssetSaved>> {
      const problem = uploadProblem(file);
      const kind = uploadKind(file.type);
      if (problem || !kind) return failed(problem ?? "unsupported_file");
      const name = (file.name.trim() || kind).slice(0, STUDIO_LIMITS.nameMax);
      const reserved = await call("asset.reserve", {
        organizationId,
        requestId: options.requestId ?? newRequestId(),
        name,
        mime: file.type,
        sizeBytes: file.size,
        ...(options.role ? { role: options.role } : {}),
        ...(options.brandProjectId ? { brandProjectId: options.brandProjectId } : {}),
      });
      if (isFailure(reserved)) return reserved;
      let put: Response;
      try {
        put =
          reserved.direct && reserved.url
            ? await fetcher(reserved.url, { method: "PUT", body: file, headers: { "Content-Type": file.type } })
            : await fetcher(`${STUDIO_ENDPOINT}/assets/${encodeURIComponent(reserved.id)}?organizationId=${encodeURIComponent(organizationId)}`, {
                method: "POST",
                body: file,
                credentials: "same-origin",
                headers: { "Content-Type": file.type },
              });
      } catch {
        return failed("failed");
      }
      if (!put.ok) return failed(STATUS_CODES[put.status] ?? "failed");
      const size = options.measure ? await options.measure(file, kind).catch(() => ({}) as MeasuredMedia) : {};
      return call("asset.complete", { organizationId, assetId: reserved.id, ...cleanMeasure(size), ...(options.transient ? { transient: true } : {}) });
    },
  };
}

export type StudioApi = ReturnType<typeof createStudioApi>;

/** Drops sizes the contract would refuse rather than failing the whole upload over them. */
function cleanMeasure(size: MeasuredMedia): MeasuredMedia {
  const out: MeasuredMedia = {};
  const whole = (v: number | undefined) => (v && Number.isFinite(v) && v > 0 && v <= 12_000 ? Math.round(v) : undefined);
  const width = whole(size.width), height = whole(size.height);
  if (width && height) Object.assign(out, { width, height });
  if (size.seconds && Number.isFinite(size.seconds) && size.seconds > 0 && size.seconds <= 600) out.seconds = size.seconds;
  return out;
}

/** Browser measurement: image size from a decoded bitmap, video size and length from its metadata. */
export async function measureInBrowser(file: Blob, kind: StudioAssetKind): Promise<MeasuredMedia> {
  if (kind === "image" && typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  }
  if (kind === "image") return {};
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<MeasuredMedia>((resolve) => {
      const media = document.createElement(kind === "video" ? "video" : "audio");
      media.preload = "metadata";
      media.onloadedmetadata = () =>
        resolve({
          seconds: Number.isFinite(media.duration) ? media.duration : undefined,
          ...(media instanceof HTMLVideoElement ? { width: media.videoWidth, height: media.videoHeight } : {}),
        });
      media.onerror = () => resolve({});
      media.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
