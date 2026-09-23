import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { getVerifiedEmail } from "@/lib/auth/verified-email";
import { getStorage } from "@/lib/storage";
import { resolveRequestUrl, sameOriginMutation } from "@/lib/routing/surfaces";
import {
  updateBrandSettings, removeBrandOrganizationLogo, sendBrandSupport, loadBrandSupport, createBrandOrganization,
  createBrandProject,
  approveBrandContent,
  sendBrandMessage,
  reserveBrandAttachment,
  completeBrandAttachment,
  createBrandInvitation,
  acceptBrandInvitation,
  revokeBrandMember,
} from "@/lib/brands/workspace/service";
export const dynamic = "force-dynamic";
const HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: HEADERS });
}
export async function POST(request: NextRequest) {
  const origin = resolveRequestUrl(new URL(request.url), request.headers);
  if (!origin || !sameOriginMutation(origin, request.headers))
    return json({ ok: false, code: "forbidden" }, 403);
  try {
    const viewer = await getViewer();
    if (!viewer.userId)
      return json({ ok: false, code: "sign_in_required" }, 401);
    if (Number(request.headers.get("content-length") ?? 0) > 65536)
      return json({ ok: false, code: "invalid" }, 413);
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 65536)
      return json({ ok: false, code: "invalid" }, 413);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ ok: false, code: "invalid" }, 400);
    }
    if (
      !body ||
      typeof body !== "object" ||
      !body.input ||
      typeof body.input !== "object"
    )
      return json({ ok: false, code: "invalid" }, 400);
    const input = body.input as Record<string, unknown>;
    const sql = await getSqlRunner();
    if (!sql) return json({ ok: false, code: "storage_unavailable" }, 503);
    let result;
    switch (body.operation) {
      case "organization.update":
        result = await updateBrandSettings({sql},viewer,input); break;
      case "organization.logo.remove":
        result = await removeBrandOrganizationLogo({ sql }, viewer, input); break;
      case "support.send":
        result = await sendBrandSupport({sql},viewer,input); break;
      case "organization.create":
        result = await createBrandOrganization({ sql }, viewer, input);
        break;
      case "project.create":
        result = await createBrandProject({ sql }, viewer, input);
        break;
      case "content.decide":
        result = await approveBrandContent({ sql }, viewer, input);
        break;
      case "message.send":
        result = await sendBrandMessage({ sql }, viewer, input);
        break;
      case "invitation.create":
        result = await createBrandInvitation({ sql }, viewer, input);
        break;
      case "invitation.accept": {
        const verifiedEmail = await getVerifiedEmail(viewer.userId);
        result = await acceptBrandInvitation(
          { sql, verifiedEmail },
          viewer,
          input,
        );
        break;
      }
      case "member.revoke":
        result = await revokeBrandMember({ sql }, viewer, input);
        break;
      case "attachment.reserve": {
        const reserved = await reserveBrandAttachment({ sql }, viewer, input);
        if (!reserved.ok) {
          result = reserved;
          break;
        }
        const storage = await getStorage();
        const url = await storage.signedUploadUrl(
          reserved.storageKey,
          String(input.mime),
        );
        if (!url && storage.servesSignedUrls)
          return json({ ok: false, code: "storage_unavailable" }, 503);
        return json({
          ok: true,
          id: reserved.id,
          direct: url !== null,
          ...(url ? { url } : {}),
        });
      }
      case "attachment.complete":
        result = await completeBrandAttachment(
          { sql, storage: await getStorage() },
          viewer,
          typeof input.id === "string" ? input.id : "",
        );
        break;
      default:
        return json({ ok: false, code: "invalid" }, 400);
    }
    return json(
      result,
      result.ok
        ? 200
        : result.code === "conflict"
          ? 409
          : result.code === "not_found"
            ? 404
            : result.code === "forbidden"
              ? 403
              : result.code === "rate_limited"
                ? 429
                : 400,
    );
  } catch {
    return json({ ok: false, code: "storage_unavailable" }, 503);
  }
}

export async function GET(request:NextRequest) {
 const [viewer,sql]=await Promise.all([getViewer(),getSqlRunner()]);
 if(!sql||!viewer.userId)return json({ok:false},404);
 const messages=await loadBrandSupport({sql,verifiedEmail:await getVerifiedEmail(viewer.userId)},viewer,request.nextUrl.searchParams.get('organizationId')??'');
 return messages?json({ok:true,messages}):json({ok:false},404);
}
