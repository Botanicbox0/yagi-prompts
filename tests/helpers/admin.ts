import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import type { Viewer } from '@/lib/auth/identity';
import type { Tier } from '@/lib/content/visibility';
import { createLocalStorageDriver } from '@/lib/storage/local-driver';
import type { StorageDriver } from '@/lib/storage';
import type { AdminContext, AdminOutcome } from '@/lib/admin/context';
import { dispatchAdmin } from '@/lib/admin/dispatch';
import { BACK_FIELD, OP_FIELD } from '@/lib/admin/form';
import { freshDb, runner } from './pglite';

/**
 * The admin operations harness: a real PGlite, a real local storage root, and an injected viewer.
 *
 * Same seam the M2 façade tests use — with no Supabase project (§11) a session cannot be minted, so
 * the viewer is INJECTED rather than faked into `getViewer()`. What is exercised for real is
 * everything below that line: zod at the boundary, the SQL, the triggers, the RPCs and the storage
 * driver.
 */

export interface AdminHarness {
  db: PGlite;
  storage: StorageDriver;
  root: string;
  revalidated: number;
  /** §13.2 — the `prompts` tag is a SECOND invalidation event; the tests assert which fires. */
  promptsRevalidated: number;
  /** §14.2 — and `contests` is the third. Counted separately so a test can prove which moved. */
  contestsRevalidated: number;
  /** docs/CAMPAIGNS.md — the fourth tag. */
  campaignsRevalidated: number;
  ctx(viewer?: Viewer): AdminContext;
  run(name: string, fields: FormFields, viewer?: Viewer): Promise<AdminOutcome>;
  close(): Promise<void>;
}

export type FormFields = Record<
  string,
  string | number | boolean | File | Array<string | File> | undefined
>;

export const ADMIN_VIEWER: Viewer = {
  tier: 'admin',
  userId: 'f0000000-0000-4000-8000-000000000003',
  email: 'admin@yagiworkshop.xyz',
  isAdmin: true,
  locale: 'en',
};

export function viewerOf(tier: Tier): Viewer {
  if (tier === 'anon') {
    return { tier: 'anon', userId: null, email: null, isAdmin: false, locale: null };
  }
  if (tier === 'admin') return ADMIN_VIEWER;
  return {
    tier,
    userId: `f0000000-0000-4000-8000-00000000000${tier === 'free' ? 1 : 2}`,
    email: `${tier}@playbook.test`,
    isAdmin: false,
    locale: 'en',
  };
}

export function formOf(op: string, fields: FormFields = {}, back = '/admin'): FormData {
  const form = new FormData();
  form.set(OP_FIELD, op);
  form.set(BACK_FIELD, back);
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      // An omitted field is an omitted field — a browser posts nothing, not "undefined".
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) form.append(key, item as string);
    } else if (value instanceof File) {
      form.set(key, value);
    } else {
      form.set(key, String(value));
    }
  }
  return form;
}

export function upload(name: string, body: string, type = 'image/png'): File {
  return new File([new TextEncoder().encode(body)], name, { type });
}

export async function adminHarness(): Promise<AdminHarness> {
  const db = await freshDb();
  const root = await mkdtemp(join(tmpdir(), 'playbook-admin-'));
  const storage = createLocalStorageDriver(root);

  const harness: AdminHarness = {
    db,
    storage,
    root,
    revalidated: 0,
    promptsRevalidated: 0,
    contestsRevalidated: 0,
    campaignsRevalidated: 0,
    ctx(viewer = ADMIN_VIEWER) {
      return {
        sql: runner(db),
        storage,
        viewer,
        revalidate: () => {
          harness.revalidated += 1;
        },
        revalidatePrompts: () => {
          harness.promptsRevalidated += 1;
        },
        revalidateContests: () => {
          harness.contestsRevalidated += 1;
        },
        revalidateCampaigns: () => {
          harness.campaignsRevalidated += 1;
        },
      };
    },
    run(name, fields, viewer = ADMIN_VIEWER) {
      return dispatchAdmin(name, formOf(name, fields), harness.ctx(viewer));
    },
    async close() {
      await db.close();
      await rm(root, { recursive: true, force: true });
    },
  };

  return harness;
}

/** Assert-and-narrow: most tests want the success path and a readable failure when it is not. */
export function expectOk(outcome: AdminOutcome): Extract<AdminOutcome, { ok: true }> {
  if (!outcome.ok) {
    throw new Error(`expected success, got ${outcome.code}: ${outcome.detail ?? ''}`);
  }
  return outcome;
}
