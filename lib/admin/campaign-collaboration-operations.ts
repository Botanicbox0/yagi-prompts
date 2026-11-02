import type { AdminOperation } from "./operations";
import { fail, ok } from "./context";
import * as f from "./form";
import {
  bindCollaboration,
  sendParticipantMessage,
  storeParticipantFile,
  revokeInvitation,
  type Outcome,
} from "@/lib/campaigns/collaboration/service";
const outcome = (r: Outcome) =>
  r.ok
    ? ok("saved")
    : fail(
        r.code === "forbidden"
          ? "forbidden"
          : r.code === "not_found"
            ? "notFound"
            : r.code === "conflict"
              ? "brandConflict"
              : r.code === "not_open"
                ? "brandNotActive"
                : r.code === "not_selected"
                  ? "badTransition"
                  : r.code === "unavailable"
                    ? "storage"
                    : r.code === "rate_limited"
                      ? "collaborationRateLimited"
                      : r.code === "invitation_retry"
                        ? "brandConflict"
                        : "invalid",
      );
const bind: AdminOperation<{ campaignId: string; projectId: string }> = {
  parse: (form) => ({
    ok: true,
    value: {
      campaignId: f.str(form, "campaignId"),
      projectId: f.str(form, "projectId"),
    },
  }),
  run: async (ctx, input) =>
    outcome(await bindCollaboration(ctx, ctx.viewer, input)),
};
const message: AdminOperation<{
  applicationId: string;
  requestId: string;
  body: string;
}> = {
  parse: (form) => ({
    ok: true,
    value: {
      applicationId: f.str(form, "applicationId"),
      requestId: f.str(form, "requestId"),
      body: f.text(form, "body"),
    },
  }),
  run: async (ctx, input) =>
    outcome(await sendParticipantMessage(ctx, ctx.viewer, input)),
};
const file: AdminOperation<{
  applicationId: string;
  requestId: string;
  file: File;
}> = {
  parse: (form) => {
    const file = form.get("file");
    if (!(file instanceof File) || file.size > 3000000)
      return { ok: false, detail: "invalid file" };
    return {
      ok: true,
      value: {
        applicationId: f.str(form, "applicationId"),
        requestId: f.str(form, "requestId"),
        file,
      },
    };
  },
  run: async (ctx, input) =>
    outcome(
      await storeParticipantFile(ctx, ctx.viewer, {
        applicationId: input.applicationId,
        requestId: input.requestId,
        name: input.file.name,
        mime: input.file.type,
        bytes: new Uint8Array(await input.file.arrayBuffer()),
      }),
    ),
};
const revoke: AdminOperation<{ invitationId: string }> = {
  parse: (form) => ({
    ok: true,
    value: { invitationId: f.str(form, "invitationId") },
  }),
  run: async (ctx, input) =>
    outcome(await revokeInvitation(ctx, ctx.viewer, input)),
};
export const CAMPAIGN_COLLABORATION_OPERATIONS = {
  "campaignCollaboration.bind": bind,
  "campaignCollaboration.message": message,
  "campaignCollaboration.file": file,
  "campaignCollaboration.revoke": revoke,
} as const;
