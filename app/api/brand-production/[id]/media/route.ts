import { getViewer } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { loadProductionOutput } from "@/lib/brands/production/service";
import { getRenderStore } from "@/lib/renders/store";
export const dynamic = "force-dynamic";
async function serve(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const [{ id }, viewer, sql] = await Promise.all([
    params,
    getViewer(),
    getSqlRunner(),
  ]);
  const headers: Record<string, string> = {
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "X-Content-Type-Options": "nosniff",
  };
  const job = sql ? await loadProductionOutput({ sql }, viewer, id) : null;
  if (!job || job.status !== "succeeded" || !job.resultKey || !job.resultMime)
    return new Response(null, { status: 404, headers });
  const store = await getRenderStore();
  let bytes: Uint8Array;
  try {
    bytes = await store.read(job.resultKey);
  } catch {
    return new Response(null, { status: 404, headers });
  }
  let start = 0,
    end = bytes.length - 1,
    status = 200;
  const range = request.headers.get("range");
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m || (!m[1] && !m[2]))
      return new Response(null, {
        status: 416,
        headers: { ...headers, "Content-Range": `bytes */${bytes.length}` },
      });
    if (m[1]) {
      start = Number(m[1]);
      if (m[2]) end = Math.min(Number(m[2]), end);
    } else start = Math.max(0, bytes.length - Number(m[2]));
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end ||
      start >= bytes.length
    )
      return new Response(null, {
        status: 416,
        headers: { ...headers, "Content-Range": `bytes */${bytes.length}` },
      });
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${bytes.length}`;
  }
  headers["Content-Type"] = job.resultMime;
  headers["Accept-Ranges"] = "bytes";
  headers["Content-Length"] = String(end - start + 1);
  if (new URL(request.url).searchParams.get("download") === "1")
    headers["Content-Disposition"] = `attachment; filename="twings-${id}.mp4"`;
  let cursor = start;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (cursor > end) {
        controller.close();
        return;
      }
      const next = Math.min(cursor + 65536, end + 1);
      controller.enqueue(bytes.subarray(cursor, next));
      cursor = next;
    },
  });
  return new Response(request.method === "HEAD" ? null : stream, {
    status,
    headers,
  });
}
export const GET = serve;
export const HEAD = serve;
