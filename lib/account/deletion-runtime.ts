import type { SqlRunner } from '@/lib/db/sql-runner';
import { arkAssetsConfigFromEnv, ArkOpenApiError, createArkAssetsClient } from '@/lib/ark/assets';
import { getRenderStore } from '@/lib/renders/store';
import { resolveRuntimeMode } from '@/lib/runtime-mode';
import type { DeletionDeps } from './deletion';

/**
 * The real tools behind `lib/account/deletion.ts`, picked by the same mode switch as everything else
 * (`lib/runtime-mode.ts`). Each one treats "already gone" as done, so a pass can be repeated.
 *
 *   files     the private `renders` bucket (or `.storage/renders/` locally).
 *   auth      Supabase Auth's admin API in cloud mode — deleting the user ends every session and
 *             removes the Google/Kakao identity link. Local mode has only the `auth.users` stub.
 *   provider  the engine provider's asset group (the member's face, privacy policy §3). `null` when
 *             this deployment has no provider credentials: a request that lists a group then stays
 *             open in the admin queue instead of pretending the group was removed.
 */
export async function liveDeletionDeps(sql: SqlRunner): Promise<DeletionDeps> {
  const store = await getRenderStore();
  const files = store.deleteFolder ? { deleteFolder: (folder: string) => store.deleteFolder!(folder) } : null;

  const auth: DeletionDeps['auth'] =
    resolveRuntimeMode(process.env) === 'local'
      ? {
          async deleteUser(userId) {
            await sql.query('delete from auth.users where id=$1', [userId]);
          },
        }
      : {
          async deleteUser(userId) {
            const { createServiceClient } = await import('@/lib/supabase/service-client');
            const { error } = await createServiceClient().auth.admin.deleteUser(userId);
            if (!error) return;
            // Already removed (a second pass, or an operator in the dashboard) is what we wanted.
            if (error.status === 404 || /not found/i.test(error.message)) return;
            throw new Error(`auth admin ${error.status ?? 'error'}`);
          },
        };

  const config = arkAssetsConfigFromEnv();
  const provider: DeletionDeps['provider'] =
    config === null
      ? null
      : {
          async deleteAssetGroup(groupId) {
            try {
              await createArkAssetsClient(config).deleteAssetGroup(groupId);
            } catch (error) {
              if (error instanceof ArkOpenApiError && (error.httpStatus === 404 || /notfound|not_found/i.test(error.code))) return;
              throw new Error(error instanceof ArkOpenApiError ? `ark ${error.code}` : 'ark request failed');
            }
          },
        };

  return { sql, files, auth, provider };
}
