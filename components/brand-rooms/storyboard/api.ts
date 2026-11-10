/**
 * The storyboard tab's typed client for `/api/brand-rooms/storyboards` (lib/brand-rooms/storyboard-contracts.ts).
 *
 * Failures always come back as `{ ok: false, code }` with a `StoryboardErrorCode`; the screen maps codes
 * to sentences and never shows a server message. A cut's picture: `frame.reserve` -> PUT to the signed
 * address when `direct`, otherwise POST the bytes to the local gateway -> `frame.complete`.
 */
import type { z } from "zod";
import {
  STORYBOARD_ERROR_CODES,
  STORYBOARD_LIMITS,
  STORYBOARD_UPLOAD_MIMES,
  type BoardCreateSchema,
  type BoardRefSchema,
  type BoardStatusSchema,
  type BoardUpdateSchema,
  type FrameAddSchema,
  type FrameCompleteSchema,
  type FrameRefSchema,
  type FrameReorderSchema,
  type FrameReserveSchema,
  type FrameTextInput,
  type FrameUpdateSchema,
  type StoryboardBoardSaved,
  type StoryboardDetail,
  type StoryboardDone,
  type StoryboardErrorCode,
  type StoryboardFailure,
  type StoryboardFrameReserved,
  type StoryboardFrameSaved,
  type StoryboardList,
  type StoryboardOperation,
} from "@/lib/brand-rooms/storyboard-contracts";

export const STORYBOARD_ENDPOINT = "/api/brand-rooms/storyboards";

/** Operation name -> [request input, success answer]. */
export interface StoryboardOps {
  "board.create": [z.input<typeof BoardCreateSchema>, StoryboardBoardSaved];
  "board.update": [z.input<typeof BoardUpdateSchema>, StoryboardBoardSaved];
  "board.share": [z.input<typeof BoardRefSchema>, StoryboardBoardSaved];
  "board.status": [z.input<typeof BoardStatusSchema>, StoryboardBoardSaved];
  "board.version": [z.input<typeof BoardRefSchema>, StoryboardBoardSaved];
  "board.delete": [z.input<typeof BoardRefSchema>, StoryboardDone];
  "frame.reserve": [z.input<typeof FrameReserveSchema>, StoryboardFrameReserved];
  "frame.complete": [z.input<typeof FrameCompleteSchema>, StoryboardFrameSaved];
  "frame.add": [z.input<typeof FrameAddSchema>, StoryboardFrameSaved];
  "frame.update": [z.input<typeof FrameUpdateSchema>, StoryboardFrameSaved];
  "frame.reorder": [z.input<typeof FrameReorderSchema>, StoryboardDone];
  "frame.delete": [z.input<typeof FrameRefSchema>, StoryboardDone];
}
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export const OPERATIONS_COVERED: Exact<keyof StoryboardOps, StoryboardOperation> = true;

export type ApiResult<T> = T | StoryboardFailure;

export const failed = (code: StoryboardErrorCode): StoryboardFailure => ({ ok: false, code });

export function isFailure<T>(value: ApiResult<T>): value is StoryboardFailure {
  return (value as { ok?: unknown }).ok === false;
}

const STATUS_CODES: Record<number, StoryboardErrorCode> = {
  400: "invalid",
  401: "sign_in_required",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  413: "file_too_large",
  415: "unsupported_file",
  503: "provider_unavailable",
};

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
  if (typeof code === "string" && (STORYBOARD_ERROR_CODES as readonly string[]).includes(code)) return failed(code as StoryboardErrorCode);
  return failed(STATUS_CODES[response.status] ?? "failed");
}

/** Checked in the browser before anything is sent; the server checks again by the bytes. */
export function pictureProblem(file: { type: string; size: number }): StoryboardErrorCode | null {
  if (!(STORYBOARD_UPLOAD_MIMES as readonly string[]).includes(file.type)) return "unsupported_file";
  if (file.size <= 0) return "unsupported_file";
  return file.size > STORYBOARD_LIMITS.imageBytesMax ? "file_too_large" : null;
}

export function createStoryboardApi({
  organizationId,
  projectId,
  fetch: fetcher = (...args) => fetch(...args),
}: {
  organizationId: string;
  projectId: string;
  fetch?: typeof fetch;
}) {
  const json = { "Content-Type": "application/json", Accept: "application/json" };
  const scope = `organizationId=${encodeURIComponent(organizationId)}&projectId=${encodeURIComponent(projectId)}`;
  async function send<T>(input: string, init: RequestInit): Promise<ApiResult<T>> {
    try {
      return await read<T>(await fetcher(input, { credentials: "same-origin", cache: "no-store", ...init }));
    } catch {
      return failed("failed");
    }
  }
  function call<O extends StoryboardOperation>(operation: O, input: Omit<StoryboardOps[O][0], "organizationId" | "projectId">): Promise<ApiResult<StoryboardOps[O][1]>> {
    return send<StoryboardOps[O][1]>(STORYBOARD_ENDPOINT, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ operation, input: { ...input, organizationId, projectId } }),
    });
  }
  return {
    list: () => send<StoryboardList>(`${STORYBOARD_ENDPOINT}?${scope}`, { method: "GET", headers: { Accept: "application/json" } }),
    detail: (boardId: string) =>
      send<StoryboardDetail>(`${STORYBOARD_ENDPOINT}?${scope}&board=${encodeURIComponent(boardId)}`, { method: "GET", headers: { Accept: "application/json" } }),
    call,
    /** One picture becomes one cut at the end of the board. */
    async uploadFrame(storyboardId: string, file: Blob & { name: string }, text?: FrameTextInput): Promise<ApiResult<StoryboardFrameSaved>> {
      const problem = pictureProblem(file);
      if (problem) return failed(problem);
      const reserved = await call("frame.reserve", {
        storyboardId,
        name: file.name,
        mime: file.type as (typeof STORYBOARD_UPLOAD_MIMES)[number],
        sizeBytes: file.size,
        ...(text ? { text } : {}),
      });
      if (isFailure(reserved)) return reserved;
      let put: Response;
      try {
        put = reserved.direct
          ? await fetcher(reserved.url, { method: "PUT", body: file, headers: { "Content-Type": file.type } })
          : await fetcher(reserved.url, { method: "POST", body: file, credentials: "same-origin", headers: { "Content-Type": file.type } });
      } catch {
        return failed("failed");
      }
      if (!put.ok) return failed(STATUS_CODES[put.status] ?? "failed");
      return call("frame.complete", { storyboardId, frameId: reserved.frameId });
    },
  };
}

export type StoryboardApi = ReturnType<typeof createStoryboardApi>;
