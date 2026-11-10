/**
 * The two doors the editor saves through: the brand's own API (`brandWriter`) and the team's admin
 * operations (`adminWriter`, `/admin/do` + `/api/admin/staging-url`). Both turn the editor's working
 * copy into the smallest set of writes and report the first refusal as a contract code.
 */
import type { StoryboardErrorCode, StoryboardFrameDetail } from "@/lib/brand-rooms/storyboard-contracts";
import { isFailure, type StoryboardApi } from "./api";
import { cutText, planSave, type DraftCut } from "./editor-model";
import type { StoryboardWriter, WriteResult } from "./editor";

const OK: WriteResult = { ok: true };

/** Run `fn` over `items`, `limit` at a time, stopping at the first failure. */
async function pool<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<WriteResult>): Promise<WriteResult> {
  let failure: WriteResult | null = null;
  let next = 0;
  const worker = async () => {
    while (!failure && next < items.length) {
      const item = items[next++]!;
      const result = await fn(item);
      if (!result.ok && !failure) failure = result;
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return failure ?? OK;
}

export function brandWriter(api: StoryboardApi, board: { id: string; title: string }): StoryboardWriter {
  return {
    async save({ title, cuts, original }, progress) {
      const storyboardId = board.id;
      if (title.trim() && title.trim() !== board.title.trim()) {
        const renamed = await api.call("board.update", { storyboardId, title: title.trim() });
        if (isFailure(renamed)) return renamed;
      }
      const plan = planSave(original, cuts);
      for (const frameId of plan.deletes) {
        const gone = await api.call("frame.delete", { storyboardId, frameId });
        if (isFailure(gone)) return gone;
      }
      if (plan.updates.length) {
        const updated = await api.call("frame.update", { storyboardId, frames: plan.updates });
        if (isFailure(updated)) return updated;
      }
      const ids = new Map<string, string>();
      let done = 0;
      const uploaded = await pool(plan.uploads, 3, async (cut) => {
        const result = await api.uploadFrame(storyboardId, cut.file!, cutText(cut));
        if (isFailure(result)) return result;
        ids.set(cut.key, result.frame.id);
        done += 1;
        progress(done, plan.uploads.length);
        return OK;
      });
      if (!uploaded.ok) return uploaded;
      if (plan.reorder || plan.uploads.length > 0) {
        const order = cuts.map((c) => c.id ?? ids.get(c.key)!).filter(Boolean);
        const moved = await api.call("frame.reorder", { storyboardId, frameIds: order });
        if (isFailure(moved)) return moved;
      }
      return OK;
    },
    async share() {
      const shared = await api.call("board.share", { storyboardId: board.id });
      return isFailure(shared) ? shared : OK;
    },
  };
}

/* ---------------------------------------------------------------- team */

const ADMIN_CODES: Record<string, StoryboardErrorCode> = {
  forbidden: "forbidden",
  notFound: "not_found",
  brandConflict: "conflict",
  upload: "unsupported_file",
  invalid: "invalid",
};

type Fetch = typeof fetch;

async function adminOp(fetcher: Fetch, op: string, back: string, fields: Record<string, string | Blob>, files: Array<[string, Blob, string]> = []): Promise<WriteResult> {
  const form = new FormData();
  form.set("_op", op);
  form.set("_back", back);
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  for (const [key, blob, name] of files) form.set(key, blob, name);
  try {
    const response = await fetcher("/admin/do", { method: "POST", body: form, credentials: "same-origin", headers: { accept: "application/json" } });
    const body = (await response.json().catch(() => null)) as { ok?: boolean; code?: string } | null;
    if (body?.ok) return OK;
    return { ok: false, code: ADMIN_CODES[body?.code ?? ""] ?? "failed" };
  } catch {
    return { ok: false, code: "failed" };
  }
}

/** A signed staging address for one picture, or null when the storage has none (local: post it inline). */
async function stage(fetcher: Fetch, file: Blob & { name: string }): Promise<{ key: string } | null | "failed"> {
  try {
    const response = await fetcher("/api/admin/staging-url", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "poster", mime: file.type, size: file.size, filename: file.name }),
    });
    const body = (await response.json().catch(() => null)) as { direct?: boolean; key?: string; url?: string } | null;
    if (!response.ok || !body) return "failed";
    if (!body.direct || !body.key || !body.url) return null;
    const put = await fetcher(body.url, { method: "PUT", body: file, headers: { "content-type": file.type } });
    return put.ok ? { key: body.key } : "failed";
  } catch {
    return "failed";
  }
}

export function adminWriter(board: { id: string }, back: string, fetcher: Fetch = (...args) => fetch(...args)): StoryboardWriter {
  return {
    async save({ title, cuts }, progress) {
      const files: Array<[string, Blob, string]> = [];
      const entries: Array<Record<string, unknown>> = [];
      const total = cuts.filter((c) => c.file).length;
      let done = 0;
      for (const [i, cut] of cuts.entries()) {
        const text = cutText(cut);
        if (!cut.file && cut.id) {
          entries.push({ id: cut.id, ...text });
          continue;
        }
        const staged = await stage(fetcher, cut.file!);
        if (staged === "failed") return { ok: false, code: "failed" };
        if (staged) entries.push({ upload: `staging:${staged.key}`, ...text });
        else {
          files.push([`picture_${i}`, cut.file!, cut.file!.name]);
          entries.push({ upload: `file:picture_${i}`, ...text });
        }
        done += 1;
        progress(done, total);
      }
      return adminOp(fetcher, "brand_rooms.storyboard.frames", back, { storyboardId: board.id, title: title.trim(), frames: JSON.stringify(entries) }, files);
    },
    share: () => adminOp(fetcher, "brand_rooms.storyboard.share", back, { storyboardId: board.id }),
  };
}

export type { DraftCut, StoryboardFrameDetail };
