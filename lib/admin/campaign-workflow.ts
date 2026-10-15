import type { ApplicationRow, CampaignRow } from "@/lib/campaigns/repo";
import type { CampaignProductionAdmin } from "@/lib/campaigns/production-admin";
import { recruitBlockers } from "@/lib/campaigns/schemas";
import { holdsSlot } from "@/lib/campaigns/state";

type StageKey =
  "brief" | "production" | "participants" | "posts" | "reward" | "payments";
export interface CampaignWorkflowStage {
  key: StageKey;
  state: "blocked" | "waiting" | "active" | "done";
  message: "ready" | "blocked" | "waiting";
  href: string;
}

/** State derives from recorded evidence, never campaign status alone or an inferred payment. */
export function campaignWorkflow(
  campaign: CampaignRow,
  applications: ApplicationRow[],
  production: CampaignProductionAdmin | null,
): CampaignWorkflowStage[] {
  const briefBlocked = recruitBlockers(campaign).length > 0;
  const selected = applications.filter((app) => holdsSlot(app.status));
  const applicants = applications.some((app) => app.status === "applied");
  const posted = applications.some((app) => app.status === "posted");
  const verified = applications.some(
    (app) => app.status === "verified" || app.status === "paid",
  );
  const allPaid =
    selected.length > 0 && selected.every((app) => app.status === "paid");
  const productionReady = Boolean(
    production?.ready &&
    production.open &&
    production.config?.enabled &&
    production.formats.some(
      (format) =>
        format.contractId === production.config?.contractId &&
        format.templateId === production.config?.templateId,
    ),
  );
  return [
    {
      key: "brief",
      state: briefBlocked ? "blocked" : "done",
      message: briefBlocked ? "blocked" : "ready",
      href: "#campaign-editor",
    },
    {
      key: "production",
      state: productionReady ? "done" : "blocked",
      message: productionReady ? "ready" : "blocked",
      href: "#campaign-production",
    },
    {
      key: "participants",
      state: applicants ? "active" : selected.length > 0 ? "done" : "waiting",
      message: applicants
        ? "blocked"
        : selected.length > 0
          ? "ready"
          : "waiting",
      href: "#campaign-applicants",
    },
    {
      key: "posts",
      state: posted ? "active" : verified ? "done" : "waiting",
      message: posted ? "blocked" : verified ? "ready" : "waiting",
      href: "#campaign-posts",
    },
    {
      key: "reward",
      state: campaign.payout ? "done" : "blocked",
      message: campaign.payout ? "ready" : "blocked",
      href: "#campaign-editor",
    },
    {
      key: "payments",
      state: allPaid ? "done" : verified ? "active" : "waiting",
      message: allPaid ? "ready" : verified ? "blocked" : "waiting",
      href: "#campaign-payments",
    },
  ];
}
