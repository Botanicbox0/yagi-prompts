import type { ReactNode } from 'react';
import { brandWorkspacePrototypeLayerOpen } from '@/lib/flags';
import type { BrandProjectDetail } from '@/lib/brands/workspace/types';

export interface ProjectPrototypeSlots {
  handoff?: ReactNode;
  brief?: ReactNode;
  aesthetic?: ReactNode;
  review?: ReactNode;
}

/**
 * Dynamically loads and renders the workspace prototype panels only when
 * `BRAND_WORKSPACE_PROTOTYPE_LAYER=on`. When off (default), none of those client modules are
 * imported, rendered, or shipped to the browser.
 */
export async function buildProjectPrototypeLayer({
  project: p,
  locale,
  generativeMediaAllowed = true,
}: {
  project: BrandProjectDetail;
  locale: string;
  generativeMediaAllowed?: boolean;
}): Promise<ProjectPrototypeSlots | null> {
  if (!brandWorkspacePrototypeLayerOpen()) return null;
  const [{ HumanHandoff }, { BriefConcierge }, { AestheticEngine }, { ReviewStage }] = await Promise.all([
    import('./human-handoff'),
    import('./brief-concierge'),
    import('./aesthetic-engine'),
    import('./review-stage'),
  ]);
  return {
    handoff: generativeMediaAllowed ? (
      <HumanHandoff
        organizationId={p.organizationId}
        projectId={p.id}
        locale={locale}
        refCount={Math.max(p.referenceLinks.length, 3)}
      />
    ) : null,
    brief: generativeMediaAllowed ? (
      <BriefConcierge
        brandName={p.organizationName}
        projectTitle={p.title}
        objective={p.objective}
        organizationId={p.organizationId}
        projectId={p.id}
        locale={locale}
      />
    ) : null,
    aesthetic: generativeMediaAllowed ? (
      <AestheticEngine locale={locale} referenceLinks={p.referenceLinks} />
    ) : null,
    review: (
      <ReviewStage
        projectId={p.id}
        contents={p.contents}
        messages={p.messages}
        decisions={p.decisions}
        locale={locale}
        generativeMediaAllowed={generativeMediaAllowed}
        productionMode={p.productionMode}
      />
    ),
  };
}
