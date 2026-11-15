import { NextRequest, NextResponse, after } from "next/server";
import { getViewer } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { getVerifiedEmail } from "@/lib/auth/verified-email";
import { getStorage } from "@/lib/storage";
import { resolveRequestUrl, sameOriginMutation } from "@/lib/routing/surfaces";
import {
  updateBrandSettings, removeBrandOrganizationLogo, sendBrandSupport, loadBrandSupport, createBrandOrganization,
  createBrandProject,
  attachIntakeBriefFiles,
  approveBrandContent,
  sendBrandMessage,
  reserveBrandAttachment,
  completeBrandAttachment,
  createBrandInvitation,
  acceptBrandInvitation,
  revokeBrandMember,
} from "@/lib/brands/workspace/service";
import {
  submitUsageInquiry,
  sendUsageMessage,
  withdrawUsageCase,
  requestUsageChanges,
  acceptUsageQuote,
} from "@/lib/brands/usage/service";
import { usagePaymentsOpen } from "@/lib/brands/usage/runtime";
import { chooseShortlistCandidates, pickShortlistCandidate } from "@/lib/brands/shortlist/service";
import {
  coerceIdentityPayload,
  confirmBrandIdentity,
  draftFromTwingsDefaults,
  ingestBrandOnboarding,
  loadBrandIdentity,
  promoteProjectDirectionToBase,
  recordMemory,
  saveBrandIdentity,
  saveLook,
  saveProjectDirectionOverride,
} from "@/lib/brands/identity/service";
import {
  approveBrandBrief,
  compileBrandBrief,
  compileBrandSpatialStageBrief,
  compileBrandVideoReverseBrief,
  promoteBrandBrief,
  reviseBrandBrief,
} from "@/lib/brands/briefs/service";
import { planBrandMicroRoiRepair } from "@/lib/brands/finish";
import { planBrandSoundAndMusicStudio } from "@/lib/brands/sound";
import {
  createStakeholderReviewShare,
  recordSpatialFramePin,
} from "@/lib/brands/review";
import {
  notifySlackBrandConcierge,
  notifySlackBrandProjectRequest,
  syncSlackConciergeReplies,
} from "@/lib/brands/concierge-slack";
import { IntakeBriefSchema } from "@/lib/brands/workspace/intake-brief";
export const dynamic = "force-dynamic";
/**
 * A staff note that must never hold up or fail the client's request: after the response where the
 * runtime offers it, otherwise awaited here with every error swallowed.
 */
async function afterResponse(task: () => Promise<unknown>): Promise<void> {
  const run = async () => {
    try {
      await task();
    } catch {
      // best effort
    }
  };
  try {
    after(run);
  } catch {
    await run();
  }
}
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
        result = await sendBrandSupport({sql},viewer,input,"client");
        if (result.ok && typeof input.organizationId === "string" && typeof input.body === "string") {
          await notifySlackBrandConcierge(sql, {
            organizationId: input.organizationId,
            userId: viewer.userId,
            body: input.body,
            messageId: String((result as { id?: string }).id ?? ""),
          }).catch(() => ({ sent: false }));
        }
        break;
      case "organization.create":
        result = await createBrandOrganization({ sql }, viewer, input);
        break;
      case "project.create":
        result = await createBrandProject({ sql }, viewer, input);
        if (result.ok && typeof input.organizationId === "string" && typeof (result as { id?: unknown }).id === "string") {
          const projectId = (result as { id: string }).id;
          const brief = IntakeBriefSchema.safeParse(input.intakeBrief);
          await afterResponse(() =>
            notifySlackBrandProjectRequest(sql, {
              organizationId: input.organizationId as string,
              projectId,
              title: typeof input.title === "string" ? input.title : "",
              track: brief.success ? brief.data.track : null,
              dueOn: brief.success ? brief.data.schedule.dueOn : null,
              budgetBand: brief.success ? brief.data.budgetBand : null,
            }),
          );
        }
        break;
      case "intake.attachFiles":
        result = await attachIntakeBriefFiles({ sql }, viewer, input);
        break;
      case "content.decide":
        result = await approveBrandContent({ sql }, viewer, input);
        break;
      case "message.send":
        result = await sendBrandMessage({ sql }, viewer, input, "client");
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
      // Secondary usage (docs/SECONDARY-USAGE.md). Payment has its own route: /api/brand-workspace/usage.
      case "usage.inquire":
        result = await submitUsageInquiry({ sql }, viewer, input); break;
      case "usage.message":
        result = await sendUsageMessage({ sql }, viewer, input, "client"); break;
      case "usage.withdraw":
        result = await withdrawUsageCase({ sql }, viewer, input); break;
      case "usage.requestChanges":
        result = await requestUsageChanges({ sql }, viewer, input); break;
      case "usage.accept":
        result = await acceptUsageQuote({ sql, paymentsOpen: usagePaymentsOpen() }, viewer, input); break;
      case "member.revoke":
        result = await revokeBrandMember({ sql }, viewer, input);
        break;
      case "shortlist.pick":
        result = await pickShortlistCandidate({ sql }, viewer, input);
        break;
      case "shortlist.choose":
        result = await chooseShortlistCandidates({ sql }, viewer, input);
        break;
      case "identity.draftDefaults":
        result = await draftFromTwingsDefaults({ sql }, viewer, input);
        break;
      case "identity.ingest":
        result = await ingestBrandOnboarding({ sql }, viewer, input);
        break;
      case "projectDirection.save":
        result = await saveProjectDirectionOverride({ sql }, viewer, input);
        break;
      case "projectDirection.promoteToBase":
        result = await promoteProjectDirectionToBase({ sql }, viewer, input);
        break;
      case "identity.save": {
        const existing =
          typeof input.organizationId === "string"
            ? await loadBrandIdentity(sql, input.organizationId)
            : null;
        result = await saveBrandIdentity({ sql }, viewer, {
          organizationId: input.organizationId,
          expectedRevision:
            typeof input.expectedRevision === "number"
              ? input.expectedRevision
              : Number(input.expectedRevision ?? 0),
          identity: coerceIdentityPayload(input, existing?.identity),
          status: "draft",
        });
        break;
      }
      case "identity.confirm":
        result = await confirmBrandIdentity({ sql }, viewer, {
          organizationId: input.organizationId,
          expectedRevision:
            typeof input.expectedRevision === "number"
              ? input.expectedRevision
              : Number(input.expectedRevision ?? 0),
        });
        break;
      case "memory.record": {
        const payload =
          input.payload && typeof input.payload === "object"
            ? input.payload
            : {
                summary:
                  typeof input.summary === "string" ? input.summary.trim() : "",
              };
        result = await recordMemory({ sql }, viewer, {
          organizationId: input.organizationId,
          kind: input.kind,
          payload,
        });
        break;
      }
      case "look.save":
        result = await saveLook({ sql }, viewer, {
          organizationId: input.organizationId,
          title: input.title,
          lutKey: input.lutKey,
          intensity:
            input.intensity !== undefined && input.intensity !== ""
              ? Number(input.intensity)
              : 1,
          skinProtect:
            input.skinProtect === undefined
              ? true
              : input.skinProtect === true ||
                input.skinProtect === "on" ||
                input.skinProtect === "true",
          source: input.source,
        });
        break;
      case "brief.compile":
        result = await compileBrandBrief({ sql }, viewer, input);
        break;
      case "brief.revise":
        result = await reviseBrandBrief({ sql }, viewer, input);
        break;
      case "brief.approve":
        result = await approveBrandBrief({ sql }, viewer, input);
        break;
      case "brief.promoteFinal":
        result = await promoteBrandBrief({ sql }, viewer, input);
        break;
      case "brief.videoReverse":
        result = await compileBrandVideoReverseBrief({ sql }, viewer, input);
        break;
      case "brief.spatialStage":
        result = await compileBrandSpatialStageBrief({ sql }, viewer, input);
        break;
      case "soundStudio.plan":
        result = await planBrandSoundAndMusicStudio({ sql }, viewer, input);
        break;
      case "reviewShare.create":
        result = await createStakeholderReviewShare({ sql }, viewer, input);
        break;
      case "reviewShare.pin":
        result = await recordSpatialFramePin({ sql }, viewer, input);
        break;
      case "microRoi.plan":
        result = await planBrandMicroRoiRepair({ sql }, viewer, {
          ...input,
          enqueueWorkstationJob: false,
        });
        break;
      case "microRoi.queue":
        result = await planBrandMicroRoiRepair({ sql }, viewer, {
          ...input,
          enqueueWorkstationJob: true,
        });
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
        : result.code === "conflict" || result.code === "existing_member_role_mismatch"
          ? 409
          : result.code === "not_found"
            ? 404
            : result.code === "forbidden"
              ? 403
              : result.code === "rate_limited"
                ? 429
                : result.code === "storage_quota_exceeded"
                  ? 413
                  : 400,
    );
  } catch {
    return json({ ok: false, code: "storage_unavailable" }, 503);
  }
}

export async function GET(request:NextRequest) {
 const [viewer,sql]=await Promise.all([getViewer(),getSqlRunner()]);
 if(!sql||!viewer.userId)return json({ok:false},404);
 const organizationId = request.nextUrl.searchParams.get('organizationId') ?? '';
 const verifiedEmail = await getVerifiedEmail(viewer.userId);
 const initialMessages=await loadBrandSupport({sql,verifiedEmail},viewer,organizationId);
 if(!initialMessages)return json({ok:false},404);
 if (organizationId) {
  await syncSlackConciergeReplies(sql, organizationId);
 }
 const messages=await loadBrandSupport({sql,verifiedEmail},viewer,organizationId);
 return messages?json({ok:true,messages}):json({ok:false},404);
}
