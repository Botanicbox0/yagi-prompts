import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/auth/viewer";
import { getVerifiedEmail } from "@/lib/auth/verified-email";
import { getSqlRunner } from "@/lib/db/connect";
import { getStorage } from "@/lib/storage";
import { resolveRequestUrl, sameOriginMutation } from "@/lib/routing/surfaces";
import { readBoundedBody } from "@/lib/creator-subscriptions/http";
import {
  issueInvitation,
  acceptInvitation,
  revokeInvitation,
  sendParticipantMessage,
  storeParticipantFile,
} from "@/lib/campaigns/collaboration/service";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers });
export async function POST(request: NextRequest) {
  const origin = resolveRequestUrl(new URL(request.url), request.headers);
  if (!origin || !sameOriginMutation(origin, request.headers))
    return json({ ok: false, code: "forbidden" }, 403);
  const viewer = await getViewer();
  if (!viewer.userId) return json({ ok: false, code: "sign_in_required" }, 401);
  // Admin mutations are registered operations through /admin/do.
  if (viewer.isAdmin) return json({ ok: false, code: "forbidden" }, 403);
  try {
    const sql = await getSqlRunner();
    if (!sql) return json({ ok: false, code: "unavailable" }, 503);
    const bytes = await readBoundedBody(request, 3200000);
    if (!bytes) return json({ ok: false, code: "invalid" }, 413);
    let result;
    const type = request.headers.get("content-type") ?? "";
    if (type.startsWith("multipart/form-data;")) {
      const f = await new Response(bytes as BodyInit, {
        headers: { "Content-Type": type },
      }).formData();
      const fields = ["applicationId", "requestId", "file"];
      if (
        [...f.keys()].some((k) => !fields.includes(k)) ||
        fields.some((k) => f.getAll(k).length !== 1) ||
        typeof f.get("applicationId") !== "string" ||
        typeof f.get("requestId") !== "string"
      )
        return json({ ok: false, code: "invalid" }, 400);
      const file = f.get("file");
      if (!(file instanceof File))
        return json({ ok: false, code: "invalid" }, 400);
      result = await storeParticipantFile(
        { sql, storage: await getStorage() },
        viewer,
        {
          applicationId: String(f.get("applicationId")),
          requestId: String(f.get("requestId")),
          name: file.name,
          mime: file.type,
          bytes: new Uint8Array(await file.arrayBuffer()),
        },
      );
    } else {
      if (type !== "application/json" || bytes.byteLength > 20000)
        return json({ ok: false, code: "invalid" }, 400);
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return json({ ok: false, code: "invalid" }, 400);
      }
      if (
        !body ||
        typeof body !== "object" ||
        Object.keys(body).some((k) => !["operation", "input"].includes(k))
      )
        return json({ ok: false, code: "invalid" }, 400);
      switch (body.operation) {
        case "invitation.create":
          result = await issueInvitation({ sql }, viewer, body.input);
          break;
        case "invitation.accept":
          result = await acceptInvitation(
            { sql, verifiedEmail: await getVerifiedEmail(viewer.userId) },
            viewer,
            body.input,
          );
          break;
        case "invitation.revoke":
          result = await revokeInvitation({ sql }, viewer, body.input);
          break;
        case "message.send":
          result = await sendParticipantMessage({ sql }, viewer, body.input);
          break;
        default:
          return json({ ok: false, code: "invalid" }, 400);
      }
    }
    return json(
      result,
      result.ok
        ? 200
        : result.code === "unavailable"
          ? 503
          : result.code === "invalid"
            ? 400
            : result.code === "not_found"
              ? 404
              : ["conflict", "invitation_retry", "application_ended"].includes(
                    result.code,
                  )
                ? 409
                : result.code === "rate_limited"
                  ? 429
                  : 403,
    );
  } catch {
    return json({ ok: false, code: "unavailable" }, 503);
  }
}
