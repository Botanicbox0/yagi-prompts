import { randomUUID } from 'node:crypto';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { BrandProjectStatus } from '@/lib/brands/workspace/types';
import { ConfirmCheck, OpForm } from '@/components/admin/chrome';
import { StudioForm } from '@/components/brand-workspace/studio-form';

/**
 * The moves `activateBrandProject` accepts from each status (lib/brands/workspace/service.ts), read
 * here only to decide what to OFFER. The service stays the authority and refuses anything else.
 */
export const BRAND_STATUS_MOVES: Record<BrandProjectStatus, ReadonlyArray<'active' | 'completed' | 'cancelled'>> = {
  requested: ['active', 'cancelled'],
  active: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

const TERMINAL = new Set(['completed', 'cancelled']);

/**
 * P2-7: one plain form per valid next status, so nothing terminal is ever preselected. Completing or
 * cancelling freezes the campaign, so those two carry a required confirmation box. A finished
 * campaign offers no status control at all.
 */
export function BrandStatusForms({ projectId, status, revision, b, admin, back, brandHost = false }: {
  projectId: string;
  back?: string;
  /** On brand.twings.app the forms post to the brand host's studio door (lib/admin/brand-host-studio.ts). */
  brandHost?: boolean;
  status: BrandProjectStatus;
  revision: number;
  b: Dictionary['brandWorkspace'];
  admin: Dictionary['admin'];
}) {
  const moves = BRAND_STATUS_MOVES[status];
  if (moves.length === 0) return <p className="bw-muted" data-brand-status-final={status}>{admin.brandStatusFinal}</p>;
  const label = { active: b.activate, completed: b.complete, cancelled: b.close } as const;
  const Form = brandHost ? StudioForm : OpForm;
  return (
    <div className="bw-grid" data-brand-status-moves={moves.join(' ')}>
      {moves.map((to) => (
        <Form key={to} op="brandWorkspace.status" back={back ?? `/admin/brand-workspace/${projectId}`} className="bw-form">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="requestId" value={randomUUID()} />
          <input type="hidden" name="expectedRevision" value={revision} />
          <input type="hidden" name="status" value={to} />
          {TERMINAL.has(to) && <ConfirmCheck label={to === 'completed' ? admin.confirmBrandComplete : admin.confirmBrandCancel} />}
          <button className={`bw-button ${TERMINAL.has(to) ? 'bw-danger' : 'bw-primary'}`} type="submit">{label[to]}</button>
        </Form>
      ))}
    </div>
  );
}

/** Admin-dictionary sentences for the brand refusals ManagedForm can receive from `/admin/do`. */
export function brandRefusals(admin: Dictionary['admin']): Record<string, string> {
  return {
    brandConflict: admin.errBrandConflict,
    brandNotActive: admin.errBrandNotActive,
    brandConsentRequired: admin.errBrandConsentRequired,
    brandNotShared: admin.errBrandNotShared,
  };
}
