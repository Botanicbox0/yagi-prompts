import 'server-only';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { Viewer } from '@/lib/auth/identity';
import { demand } from '@/lib/creator-platform/contract';
import { lockUser, platformReady } from '@/lib/creator-platform/service';

export const OWL_P_ATTESTATION_VERSION = 'owl-p-v1';

/** Lightweight Open Maker: any signed-in member with 1-click OWL-P attestation can author & publish unless killed. */
export async function openMakerEnabled(
  sql: SqlRunner,
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  if (env.TWINGS_OPEN_MAKER === 'off') return false;
  if (typeof sql?.query !== 'function') return false;
  return platformReady(sql);
}

export interface ActivateOpenMakerResult {
  active: true;
  contractVersion: string;
  attestationVersion: string;
}

/**
 * Lightweight 1-click Open Maker onboarding (OWL-P pledge).
 * Any signed-in member can self-activate with 1 rights pledge checkbox, unless an admin revoked them.
 */
export async function activateOpenMaker(
  sql: SqlRunner,
  viewer: Viewer,
  input: { rightsAgreed: boolean },
): Promise<ActivateOpenMakerResult> {
  demand(viewer.userId, 'sign_in_required');
  demand(input.rightsAgreed === true, 'rights_required');
  const userId = viewer.userId;

  return sql.transaction(async (tx) => {
    await lockUser(tx, userId);
    const existing = await tx.query<{
      active: boolean;
      contract_version: string;
      approved_by: string | null;
    }>('select active, contract_version, approved_by from platform_creators where user_id=$1 for update', [userId]);

    const row = existing.rows[0];
    if (row && !row.active && row.approved_by && row.approved_by !== userId) {
      demand(false, 'forbidden');
    }

    const contractVersion = row?.contract_version || OWL_P_ATTESTATION_VERSION;
    await tx.query(
      `insert into platform_creators(user_id, active, approved_by, contract_version)
       values($1, true, $1, $2)
       on conflict(user_id) do update
         set active = true,
             approved_by = coalesce(platform_creators.approved_by, excluded.approved_by),
             contract_version = coalesce(nullif(platform_creators.contract_version, ''), excluded.contract_version)`,
      [userId, contractVersion],
    );

    try {
      await tx.query(
        `update platform_creators
           set attested_at = coalesce(attested_at, now()),
               attestation_version = coalesce(attestation_version, $2)
         where user_id = $1`,
        [userId, OWL_P_ATTESTATION_VERSION],
      );
    } catch {
      // Pre-0087 schemas do not carry attested_at/attestation_version columns yet.
    }

    return {
      active: true,
      contractVersion,
      attestationVersion: OWL_P_ATTESTATION_VERSION,
    };
  });
}
