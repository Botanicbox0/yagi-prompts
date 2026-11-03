import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
vi.mock('server-only', () => ({}));
import { freshDb, runner } from '../helpers/pglite';
import { ADMIN_VIEWER } from '../helpers/admin';
import {
  ADMIN_QUEUES,
  ADMIN_QUEUE_GROUPS,
  adminNextActions,
  adminQueueStates,
} from '@/lib/admin/queues';
import { loadAdminQueues } from '@/lib/admin/queue-load';
import { getDictionary } from '@/lib/i18n/dictionaries';

/** docs/ADMIN.md §2.2 — the queue home reads this registry and nothing else. */
describe('admin queue registry', () => {
  it('opens a real admin screen for every queue', () => {
    for (const queue of ADMIN_QUEUES) {
      const path = new URL(queue.href, 'https://admin.invalid').pathname;
      expect(path.startsWith('/admin')).toBe(true);
      const page = join(process.cwd(), 'app', '(admin)', ...path.split('/').filter(Boolean), 'page.tsx');
      expect(existsSync(page), queue.href).toBe(true);
    }
  });

  it('keeps keys unique, puts every queue in a shown group, and names it in both languages', () => {
    const keys = ADMIN_QUEUES.map((queue) => queue.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const locale of ['ko', 'en'] as const) {
      const dict = getDictionary(locale);
      for (const queue of ADMIN_QUEUES) {
        expect(ADMIN_QUEUE_GROUPS).toContain(queue.group);
        expect(dict.adminConsole.queues[queue.key].length).toBeGreaterThan(0);
        expect(dict.adminWorkflow.tasks[queue.key].title.length).toBeGreaterThan(0);
      }
      for (const group of ADMIN_QUEUE_GROUPS) expect(dict.adminConsole.queueGroups[group].length).toBeGreaterThan(0);
    }
  });

  it('never turns an uncounted source into zero', () => {
    const states = adminQueueStates({ risk: 2, templates: 0 });
    expect(states).toHaveLength(ADMIN_QUEUES.length);
    expect(states.find((state) => state.key === 'feedback')?.count).toBeNull();
    expect(states.find((state) => state.key === 'templates')?.count).toBe(0);
  });

  it('lists only waiting work, customers and safety before supply', () => {
    const next = adminNextActions({ templates: 3, risk: 1, feedback: null, studio: 0, payouts: 2 });
    expect(next.map((queue) => [queue.key, queue.count])).toEqual([
      ['risk', 1],
      ['payouts', 2],
      ['templates', 3],
    ]);
  });
});

describe('counting the queues against the real schema', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await freshDb();
    await db.query('insert into auth.users (id) values ($1)', [ADMIN_VIEWER.userId]);
    await db.query('insert into profiles (id, email, is_admin) values ($1, $2, true)', [ADMIN_VIEWER.userId, ADMIN_VIEWER.email]);
  });
  afterAll(async () => {
    await db.close();
  });

  it('counts every source without throwing, and an empty studio reads as zero, not as unknown', async () => {
    const loaded = await loadAdminQueues(runner(db), ADMIN_VIEWER, new Date('2026-11-03T00:00:00Z'));
    for (const key of ['paymentsManual', 'renderFailures', 'feedback', 'studio', 'inquiries', 'posts', 'applicants', 'payouts', 'templates'] as const) {
      expect(loaded.counts[key], key).toBe(0);
    }
    for (const queue of ADMIN_QUEUES) {
      const value = loaded.counts[queue.key];
      expect(value === null || (typeof value === 'number' && value >= 0), queue.key).toBe(true);
    }
  });

  // Runs last: it drops a table. One missing source must not take the other queues with it.
  it('reports a source it cannot read as unknown and keeps counting the rest', async () => {
    await db.exec('drop table render_feedback cascade');
    const loaded = await loadAdminQueues(runner(db), ADMIN_VIEWER);
    expect(loaded.counts.feedback).toBeNull();
    expect(loaded.counts.inquiries).toBe(0);
    expect(loaded.counts.templates).toBe(0);
  });
});
