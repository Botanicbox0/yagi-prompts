import 'server-only';
import { getSqlRunner } from '@/lib/db/connect';
import { recordEvent, type EventInput } from './track';

/**
 * The server-side wrapper: resolves the `SqlRunner` and records, swallowing everything.
 *
 * Split from `lib/events/track.ts` for the same reason `lib/content/facade.ts` is split from
 * `playbook-access.ts` — the pure half must stay importable from vitest, and `getSqlRunner` carries
 * the `server-only` guard.
 */
export async function track(input: EventInput): Promise<void> {
  try {
    const sql = await getSqlRunner();
    if (sql === null) return;
    await recordEvent(sql, input);
  } catch {
    // Analytics never breaks a render (§ M3 brief). This catch is the contract, not defensiveness.
  }
}

/**
 * Fire-and-forget from a server component.
 *
 * `void`-ing the promise on purpose: awaiting an analytics insert would put it on the critical path
 * of the page it is measuring. Errors are already swallowed inside `track`.
 */
export function trackAsync(input: EventInput): void {
  void track(input);
}
