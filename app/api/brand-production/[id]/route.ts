import { after, NextResponse } from "next/server";
import { getViewer } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { loadProductionOutput } from "@/lib/brands/production/service";
import { runLiveRenderPass } from "@/lib/renders/runtime";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const [{ id }, viewer, sql] = await Promise.all([
      params,
      getViewer(),
      getSqlRunner(),
    ]),
    headers = {
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    };
  const job = sql ? await loadProductionOutput({ sql }, viewer, id) : null;
  if (!job)
    return NextResponse.json(
      { ok: false, code: "not_found" },
      { status: 404, headers },
    );
  if (job.status === "queued" || job.status === "running")
    after(async () => {
      try {
        await runLiveRenderPass(sql!, { jobId: id, limit: 1 });
      } catch {
        /* persisted retry */
      }
    });
  return NextResponse.json(
    { id: job.id, status: job.status, released: job.released },
    { headers },
  );
}
