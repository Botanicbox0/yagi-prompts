import type { BrandMessage } from "@/lib/brands/workspace/types";
import type { ProductionContractView } from "./service";

/**
 * Where a brand stands in the self-serve studio, for the page layout only. Every action still
 * authorizes on the server (`./service.ts`); this never grants or hides a permission by itself.
 *
 * - `onboarding`: nothing requested yet and this account can request: the first action is a template request.
 * - `requested`: a template request is in the support thread, no contract yet.
 * - `read-only`: no contract, and this account cannot request (viewer, TWINGS team view).
 * - `templates-pending`: a usable contract exists but TWINGS has not added its templates yet.
 * - `ready`: at least one usable contract has a template to create from.
 * - `used-up`: no contract can start a video now (not started yet, ended, paused or allowance used).
 */
export type StudioStage = "onboarding" | "requested" | "read-only" | "templates-pending" | "ready" | "used-up";

type ContractState = Pick<ProductionContractView, "active" | "remaining"> & { templates: readonly unknown[] };

export function studioStage(input: {
  contracts: readonly ContractState[];
  canRequest: boolean;
  request: StudioRequestStatus | null;
}): StudioStage {
  const { contracts, canRequest, request } = input;
  if (!contracts.length) return request ? "requested" : canRequest ? "onboarding" : "read-only";
  const usable = contracts.filter((c) => c.active && c.remaining > 0);
  if (usable.some((c) => c.templates.length > 0)) return "ready";
  return usable.length ? "templates-pending" : "used-up";
}

export interface StudioRequestStatus {
  /** When the latest template request was sent. */
  sentAt: string;
  /** TWINGS has written in the thread since then. */
  answered: boolean;
}

/**
 * The latest template request in the brand's support thread. `StudioInquiry` sends it as a normal
 * support message headed by `messageTitle`, in the sender's language, so every locale's title counts.
 */
export function studioRequestStatus(messages: readonly BrandMessage[], titles: readonly string[]): StudioRequestStatus | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.authorRole !== "brand" || !titles.some((title) => m.body.startsWith(title))) continue;
    return { sentAt: m.createdAt, answered: messages.slice(i + 1).some((r) => r.authorRole === "studio") };
  }
  return null;
}
