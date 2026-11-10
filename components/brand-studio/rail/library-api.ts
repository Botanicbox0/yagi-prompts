/**
 * The rail's typed client for `/api/brand-studio/library` (lib/brand-studio/library-contracts.ts).
 * Failures always come back as `{ ok: false, code }` with a studio error code; the rail maps codes to
 * its own sentences and never shows a server message.
 */
import { STUDIO_ERROR_CODES, type StudioErrorCode, type StudioFailure } from "@/lib/brand-studio/contracts";
import type { LibraryFolderItems, LibraryOperation, LibraryOps, LibrarySummary } from "@/lib/brand-studio/library-contracts";

export const LIBRARY_ENDPOINT = "/api/brand-studio/library";

export type LibraryResult<T> = T | StudioFailure;

export function libraryFailed(value: unknown): value is StudioFailure {
  return Boolean(value) && (value as { ok?: unknown }).ok === false;
}

const STATUS_CODES: Record<number, StudioErrorCode> = {
  401: "sign_in_required",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  422: "reference_missing",
};

async function read<T>(response: Response): Promise<LibraryResult<T>> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  if (response.ok && record?.ok === true) return record as T;
  const code = record?.code;
  if (typeof code === "string" && (STUDIO_ERROR_CODES as readonly string[]).includes(code)) return { ok: false, code: code as StudioErrorCode };
  return { ok: false, code: STATUS_CODES[response.status] ?? "failed" };
}

/** Operation input without the organization, which the client adds. */
export type LibraryInput<O extends LibraryOperation> = Omit<LibraryOps[O][0], "organizationId">;

export interface LibraryApi {
  summary(): Promise<LibraryResult<LibrarySummary>>;
  folder(folderId: string): Promise<LibraryResult<LibraryFolderItems>>;
  call<O extends LibraryOperation>(operation: O, input: LibraryInput<O>): Promise<LibraryResult<LibraryOps[O][1]>>;
}

export function createLibraryApi({ organizationId, fetch: fetcher = (...args) => fetch(...args) }: { organizationId: string; fetch?: typeof fetch }): LibraryApi {
  const query = (extra = "") => `${LIBRARY_ENDPOINT}?organizationId=${encodeURIComponent(organizationId)}${extra}`;
  async function send<T>(input: string, init: RequestInit): Promise<LibraryResult<T>> {
    try {
      return await read<T>(await fetcher(input, { credentials: "same-origin", cache: "no-store", ...init }));
    } catch {
      return { ok: false, code: "failed" };
    }
  }
  const accept = { Accept: "application/json" };
  return {
    summary: () => send<LibrarySummary>(query(), { method: "GET", headers: accept }),
    folder: (folderId) => send<LibraryFolderItems>(query(`&folder=${encodeURIComponent(folderId)}`), { method: "GET", headers: accept }),
    call: (operation, input) =>
      send(LIBRARY_ENDPOINT, {
        method: "POST",
        headers: { ...accept, "Content-Type": "application/json" },
        body: JSON.stringify({ operation, input: { ...input, organizationId } }),
      }),
  };
}
