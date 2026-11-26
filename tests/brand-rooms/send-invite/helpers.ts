/**
 * Shared fixtures for 초대하고 보내기 (docs/BRAND-PROJECT-SPINE.md §8.5; slice 4c), on top of 보내기's (../send/helpers.ts):
 * people who are not members yet (by an example.com address), invitations written straight into the table (as the
 * migrations allow), lines waiting for them, and the two routes (`POST /api/brand-rooms/messages`,
 * `POST /api/brand-workspace`) driven in this process with a recording runner.
 *
 * Nothing here imports the slice's own modules, so the closed-state tests can run on origin/main's code too (their
 * snapshot was recorded that way; the slice 4c report records the run).
 */
import { createHash, randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { seedProfile } from '../../helpers/billing';

/** A sign-in that is not a member of anything: a profile with this address. */
export async function person(sql: SqlRunner, email: string): Promise<string> {
  const id = randomUUID();
  await seedProfile(sql, { id, email });
  return id;
}

/** A 43-character link token (the form `invitation.accept` takes), from a short seed so a test can name it. */
export function tokenOf(seed: string): string {
  return createHash('sha256').update(`token:${seed}`).digest('base64url').slice(0, 43);
}

/** An organization invitation written straight into `brand_invites` (as the members page writes one). */
export async function invitation(
  sql: SqlRunner,
  v: {
    organizationId: string;
    email: string;
    role?: 'owner' | 'editor' | 'viewer';
    createdBy: string;
    token: string;
    /** Seconds before now (distinct values keep lists that sort by creation time deterministic). */
    ageSeconds?: number;
    expiresAt?: string | null;
    projectId?: string | null;
  },
): Promise<string> {
  const hash = createHash('sha256').update(v.token).digest('hex');
  return (
    await sql.query<{ id: string }>(
      `insert into brand_invites (organization_id, project_id, email, role, token_hash, created_at, expires_at, created_by, request_id)
         values ($1, $2, $3, $4, $5, now() - make_interval(secs => $9::int), coalesce($6::timestamptz, now() - make_interval(secs => $9::int) + interval '7 days'), $7, $8)
       returning id::text as id`,
      [v.organizationId, v.projectId ?? null, v.email, v.role ?? 'viewer', hash, v.expiresAt ?? null, v.createdBy, randomUUID(), v.ageSeconds ?? 0],
    )
  ).rows[0]!.id;
}

/** A line waiting for an invitation, written straight into the 0202 table. */
export async function waiting(sql: SqlRunner, v: { organizationId: string; messageId: string; inviteId: string }): Promise<void> {
  await sql.query('insert into brand_room_pending_mentions (message_id, invite_id, organization_id) values ($1, $2, $3)', [v.messageId, v.inviteId, v.organizationId]);
}

export function recording(sql: SqlRunner, texts: string[]): SqlRunner {
  const wrap = (inner: SqlRunner): SqlRunner => ({
    query: (text, params) => {
      texts.push(text.replace(/\s+/g, ' ').trim());
      return inner.query(text, params);
    },
    transaction: (fn) => inner.transaction((tx) => fn(wrap(tx))),
  });
  return wrap(sql);
}

/** Ids, link tokens, media keys and times in an answer replaced by their order of appearance, so a snapshot holds across runs. */
export function normalizer(): (value: unknown) => unknown {
  const seen = new Map<string, string>();
  return (value: unknown) => {
    const text = JSON.stringify(value ?? null)
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<time>')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|st\/[0-9a-f]{64}\.[a-z0-9]+|"[A-Za-z0-9_-]{43}"/g, (hit) => {
        if (/^"/.test(hit)) return '"<token>"';
        if (!seen.has(hit)) seen.set(hit, `<${hit.startsWith('st/') ? 'key' : 'id'}${seen.size + 1}>`);
        return seen.get(hit)!;
      });
    return JSON.parse(text);
  };
}

/** Every switch 초대하고 보내기 needs on top of 보내기's (../send/helpers.ts `openSend`). */
export function openInvites(): void {
  vi.stubEnv('BRAND_SEND_INVITE', 'on');
}
