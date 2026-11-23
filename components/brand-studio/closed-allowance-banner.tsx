"use client";

import { buildClosedAllowanceDraft, openBrandSupport } from "../brand-workspace/support-trigger";
import type { StudioCopy } from "./copy";

export function ClosedAllowanceBanner({
  organizationId,
  organizationName,
  dockCopy,
}: {
  organizationId: string;
  organizationName?: string | null;
  dockCopy: StudioCopy["dock"];
}) {
  return (
    <section className="bs-closed" data-studio-allowance-closed>
      <h2>{dockCopy.closedTitle}</h2>
      <p>{dockCopy.closedBody}</p>
      <button
        type="button"
        className="bs-btn"
        data-variant="solid"
        data-size="md"
        onClick={() => openBrandSupport({ organizationId, draft: buildClosedAllowanceDraft(dockCopy, organizationName) })}
      >
        {dockCopy.closedAction}
      </button>
    </section>
  );
}
