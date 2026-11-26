import { NextRequest, NextResponse, after } from "next/server";
import { getViewer } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { getVerifiedEmail } from "@/lib/auth/verified-email";
import { getStorage } from "@/lib/storage";
import { resolveRequestUrl, sameOriginMutation } from "@/lib/routing/surfaces";
import {
  updateBrandSettings, removeBrandOrganizationLogo, sendBrandSupport, loadBrandSupport, loadBrandSupportLatestStudioReply, createBrandOrganization,
  createBrandProject,
  attachIntakeBriefFiles,
  approveBrandContent,
  sendBrandMessage,
  reserveBrandAttachment,
  completeBrandAttachment,
  createBrandInvitation,
  cancelBrandInvitation,
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
import { runLiveTeamNoticeDeliveryPass } from "@/lib/brands/team-notice-outbox";
import { IntakeBriefSchema } from "@/lib/brands/workspace/intake-brief";
import { enqueueNotices } from "@/lib/brand-rooms/notices";
import { brandOrgInviteEmailOpen, brandRoomInvitesOpen } from "@/lib/flags";
import { getMailer } from "@/lib/notify/service";
import { deliverOrgInviteEmail } from "@/lib/brands/workspace/invite-mail";
import { sendInviteAcceptHooks } from "@/lib/brand-rooms/send-invite";
import { BRAND_NEWS_CLOSED, dismissHomeAnnouncement } from "@/lib/brand-news/service";
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
          const messageId = String((result as { id?: string }).id ?? "");
          await afterResponse(async () => {
            const pass = await runLiveTeamNoticeDeliveryPass(sql, {
              sourceKind: "support_message",
              sourceId: messageId,
            });
            if (!pass.available) {
              await notifySlackBrandConcierge(sql, {
                organizationId: input.organizationId as string,
                userId: viewer.userId,
                body: input.body as string,
                messageId,
              });
            }
          });
        }
        break;
      case "organization.create":
        result = await createBrandOrganization({ sql }, viewer, input);
        if (result.ok && typeof (result as { id?: unknown }).id === "string") {
          const orgId = (result as { id: string }).id;
          await afterResponse(() =>
            runLiveTeamNoticeDeliveryPass(sql, {
              sourceKind: "org_created",
              sourceId: orgId,
            }),
          );
        }
        break;
      case "project.create":
        result = await createBrandProject({ sql }, viewer, input);
        if (result.ok && typeof input.organizationId === "string" && typeof (result as { id?: unknown }).id === "string") {
          const projectId = (result as { id: string }).id;
          const brief = IntakeBriefSchema.safeParse(input.intakeBrief);
          await afterResponse(async () => {
            const pass = await runLiveTeamNoticeDeliveryPass(sql, {
              sourceKind: "project_request",
              sourceId: projectId,
            });
            if (!pass.available) {
              await notifySlackBrandProjectRequest(sql, {
                organizationId: input.organizationId as string,
                projectId,
                title: typeof input.title === "string" ? input.title : "",
                track: brief.success ? brief.data.track : null,
                dueOn: brief.success ? brief.data.schedule.dueOn : null,
                budgetBand: brief.success ? brief.data.budgetBand : null,
              });
            }
          });
          // The receipt mail to the person who sent the request (docs/BRAND-ROOMS-FEEDBACK.md §2.1).
          // Off unless BRAND_ROOM_NOTIFY=on; never fails the request; a retried request is not mailed twice.
          await enqueueNotices(sql, { type: "intake", organizationId: input.organizationId as string, projectId, actorId: viewer.userId });
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
      case "invitation.create": {
        const created = await createBrandInvitation({ sql }, viewer, input);
        if (created.ok && brandOrgInviteEmailOpen()) {
          const role = input.role === "viewer" ? "viewer" : "editor";
          const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
          const organizationId = typeof input.organizationId === "string" ? input.organizationId : "";
          const mailState = await deliverOrgInviteEmail({
            sql,
            mailer: getMailer(),
            inviteId: created.id,
            organizationId,
            inviterUserId: viewer.userId,
            email,
            role,
            token: created.token,
            locale: viewer.locale === "en" ? "en" : "ko",
          });
          result = { ...created, mailState };
        } else {
          result = created;
        }
        break;
      }
      // The owner's cancel on the team page; authorized in the service like invitation.create.
      case "invitation.cancel":
        result = await cancelBrandInvitation({ sql }, viewer, input);
        break;
      case "invitation.accept": {
        const verifiedEmail = await getVerifiedEmail(viewer.userId);
        // docs/BRAND-ROOMS-FEEDBACK.md §12: with invitations on, a project invitation binds to the account
        // that accepts it and lands in the project room. Off: the strict e-mail match and today's landing.
        const invitesOn = brandRoomInvitesOpen();
        // 초대하고 보내기 (docs/BRAND-PROJECT-SPINE.md §8.5): lines waiting for this invitation reach the new member;
        // closed (BRAND_SEND_INVITE off, 보내기 closed, 0202 absent), the hooks read nothing and change nothing.
        result = await acceptBrandInvitation(
          { sql, verifiedEmail, projectGuestBinding: invitesOn, roomLanding: invitesOn, sendInvites: sendInviteAcceptHooks() },
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
      case "news.dismiss": {
        // docs/BRAND-PROJECT-SPINE.md §6 (slice 3b): close the home's announcement for this person. While the slot
        // is closed (BRAND_NEWS off, or migration 0196 missing) this answers exactly like an unknown operation.
        const dismissed = await dismissHomeAnnouncement({ sql }, viewer, input);
        if (dismissed === BRAND_NEWS_CLOSED) return json({ ok: false, code: "invalid" }, 400);
        result = dismissed;
        break;
      }
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
 // `&peek=1`: the support launcher's read on every page view. Same viewer, same access check and the same
 // refusal as below, but only the newest team reply's time, and no outside call to pick up replies.
 if (request.nextUrl.searchParams.get('peek') === '1') {
  const peek = await loadBrandSupportLatestStudioReply({ sql, verifiedEmail }, viewer, organizationId);
  return peek ? json({ ok: true, latestStudioReplyAt: peek.latestStudioReplyAt }) : json({ ok: false }, 404);
 }
 const initialMessages=await loadBrandSupport({sql,verifiedEmail},viewer,organizationId);
 if(!initialMessages)return json({ok:false},404);
 if (organizationId) {
  await syncSlackConciergeReplies(sql, organizationId);
 }
 const messages=await loadBrandSupport({sql,verifiedEmail},viewer,organizationId);
 return messages?json({ok:true,messages}):json({ok:false},404);
}
