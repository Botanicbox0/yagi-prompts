import { after, NextResponse } from "next/server";
import { getViewer } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { getRenderStore } from "@/lib/renders/store";
import { createBrandRenderJob } from "@/lib/renders/service";
import { runLiveRenderPass } from "@/lib/renders/runtime";
import { resolveRequestUrl, sameOriginMutation } from "@/lib/routing/surfaces";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const productionHeaders = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
};
export async function POST(request: Request) {
  const json = (body: unknown, status: number) =>
    NextResponse.json(body, { status, headers: productionHeaders });
  const origin = resolveRequestUrl(new URL(request.url), request.headers);
  if (!origin || !sameOriginMutation(origin, request.headers))
    return json({ ok: false, code: "forbidden" }, 403);
  const viewer = await getViewer();
  if (!viewer.userId) return json({ ok: false, code: "sign_in_required" }, 401);
  const sql = await getSqlRunner();
  if (!sql) return json({ ok: false, code: "unavailable" }, 503);
  let v: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 16384)
      return json({ ok: false, code: "invalid" }, 413);
    v = JSON.parse(raw);
    if (!v || typeof v !== "object") throw Error();
  } catch {
    return json({ ok: false, code: "invalid" }, 400);
  }
  try {
    const result = await createBrandRenderJob(
      { sql, store: await getRenderStore() },
      viewer,
      {
        contractId: String(v.contractId ?? ""),
        templateId: String(v.templateId ?? ""),
        requestId: String(v.requestId ?? ""),
        selfieId: String(v.selfieId ?? ""),
        ownFaceConfirmed: v.ownFaceConfirmed === true,
        locale: typeof v.locale === "string" ? v.locale : null,
      },
    );
    if (!result.ok)
      return json(result, result.code === "not_found" ? 404 : 409);
    after(async () => {
      try {
        await runLiveRenderPass(sql, { jobId: result.id, limit: 1 });
      } catch {
        /* The authenticated result poll and daily tick recover the persisted job. */
      }
    });
    return json(result, 201);
  } catch {
    return json({ ok: false, code: "unavailable" }, 503);
  }
}
