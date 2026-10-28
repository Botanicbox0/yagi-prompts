import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { lineOf } from './fields';
import { creativeProfilesReady } from './profile';

/**
 * docs/PLATFORM-2.0.md §20.5 — personal access tokens for an AI creative's own agent (the TWINGS MCP
 * server, `/api/mcp`). A token is `twk_` + 40 lowercase letters and digits, shown ONCE at creation;
 * the database keeps only its SHA-256 and a six-character prefix for the list. A token acts as its
 * creative and nobody else, only while they are an active creative, and can be revoked at any time.
 */

export const MAKER_TOKENS_MAX = 5;
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const TOKEN = /^twk_[0-9a-z]{40}$/;

export interface MakerToken { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null }
export type TokenErrorCode = 'invalid' | 'limit_reached' | 'not_found' | 'unavailable';
export class TokenError extends Error {
  constructor(readonly code: TokenErrorCode) { super(code); this.name = 'TokenError'; }
}

function newToken(): string {
  let out = '';
  // Rejection sampling: 252 is the largest multiple of 36 below 256, so every character is uniform.
  while (out.length < 40) for (const byte of randomBytes(48)) if (byte < 252 && out.length < 40) out += ALPHABET[byte % 36];
  return `twk_${out}`;
}

export function hashMakerToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : value === null || value === undefined ? null : String(value));

export async function listMakerTokens(sql: SqlRunner, userId: string): Promise<MakerToken[]> {
  if (!(await creativeProfilesReady(sql))) return [];
  const { rows } = await sql.query<{ id: string; name: string; prefix: string; created_at: unknown; last_used_at: unknown }>(
    'select id,name,prefix,created_at,last_used_at from maker_tokens where user_id=$1 and revoked_at is null order by created_at desc', [userId]);
  return rows.map((row) => ({ id: row.id, name: row.name, prefix: row.prefix, createdAt: iso(row.created_at)!, lastUsedAt: iso(row.last_used_at) }));
}

/** Creates a token for an active creative the caller has already authorised. The plain token is returned once. */
export async function createMakerToken(sql: SqlRunner, userId: string, rawName: unknown): Promise<{ token: string; record: MakerToken }> {
  if (!(await creativeProfilesReady(sql))) throw new TokenError('unavailable');
  const name = lineOf(rawName, 40);
  if (!name) throw new TokenError('invalid');
  return sql.transaction(async (tx) => {
    await tx.query('select id from profiles where id=$1 for update', [userId]);
    const { rows: count } = await tx.query<{ n: number }>('select count(*)::int n from maker_tokens where user_id=$1 and revoked_at is null', [userId]);
    if (count[0]!.n >= MAKER_TOKENS_MAX) throw new TokenError('limit_reached');
    const token = newToken();
    const id = randomUUID();
    const { rows } = await tx.query<{ created_at: unknown }>('insert into maker_tokens(id,user_id,name,token_hash,prefix) values($1,$2,$3,$4,$5) returning created_at',
      [id, userId, name, hashMakerToken(token), token.slice(0, 10)]);
    return { token, record: { id, name, prefix: token.slice(0, 10), createdAt: iso(rows[0]!.created_at)!, lastUsedAt: null } };
  });
}

export async function revokeMakerToken(sql: SqlRunner, userId: string, id: unknown): Promise<void> {
  if (!(await creativeProfilesReady(sql))) throw new TokenError('unavailable');
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new TokenError('not_found');
  const { rows } = await sql.query('update maker_tokens set revoked_at=now() where id=$1 and user_id=$2 and revoked_at is null returning id', [id, userId]);
  if (!rows.length) throw new TokenError('not_found');
}

/**
 * `Authorization: Bearer twk_…` → the creative's account id, or null. Refused when the token is
 * malformed, unknown, revoked, or its owner is no longer an active creative. `last_used_at` moves at
 * most every five minutes, so a busy agent does not write on every call.
 */
export async function resolveMakerToken(sql: SqlRunner, authorization: string | null): Promise<string | null> {
  const match = authorization ? /^Bearer\s+(\S+)$/i.exec(authorization.trim()) : null;
  const token = match?.[1] ?? '';
  if (!TOKEN.test(token) || !(await creativeProfilesReady(sql))) return null;
  const hash = hashMakerToken(token);
  const { rows } = await sql.query<{ id: string; user_id: string; token_hash: string }>(`select t.id,t.user_id,t.token_hash from maker_tokens t
    join platform_creators c on c.user_id=t.user_id and c.active where t.token_hash=$1 and t.revoked_at is null`, [hash]);
  const row = rows[0];
  if (!row || !timingSafeEqual(Buffer.from(row.token_hash), Buffer.from(hash))) return null;
  await sql.query("update maker_tokens set last_used_at=now() where id=$1 and (last_used_at is null or last_used_at < now() - interval '5 minutes')", [row.id]);
  return row.user_id;
}
