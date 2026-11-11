/**
 * Best-effort cleanup of one-shot staging objects in the private `content` bucket after their bytes have
 * been verified and copied into the studio media store (`R-01` / `R-04` in `docs/SCALE-RISKS-2026-11.md`).
 *
 * `StorageDriver` is intentionally write-once and never exposes a delete method (`lib/storage/index.ts`),
 * so staging cleanup lives in its own narrow helper restricted to room attachment and delivery staging keys.
 */
import { getStorage } from '@/lib/storage';
import { ROOM_STAGING_KEY } from './message-contracts';

const DELIVERY_KEY = /^brand-rooms\/deliveries\/[0-9a-f]{64}\.(?:png|jpg|webp|mp4|mov)$/;

export function isPurgeableRoomStagingKey(key: string): boolean {
  return ROOM_STAGING_KEY.test(key) || DELIVERY_KEY.test(key);
}

export async function purgeStagingObject(key: string): Promise<void> {
  if (!isPurgeableRoomStagingKey(key)) return;
  try {
    const storage = await getStorage();
    await storage.releaseStaging?.(key);
  } catch (error) {
    console.warn(
      '[brand-rooms] staging_purge_failed',
      JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' }),
    );
  }
}
