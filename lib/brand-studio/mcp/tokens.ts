/**
 * Personal MCP token lifecycle & SHA-256 verification (`brand_studio_mcp_tokens`, `0087`).
 *
 * Security & Founder Mandates:
 * - Raw tokens (`twmcp_<48 hex>`) are generated once and NEVER persisted in the database;
 *   only `token_hash` (SHA-256 hex) and `token_prefix` (`twmcp_<8 hex>`) are stored.
 * - NO artificial per-token daily credit cap: MCP calls use the organization's normal studio
 *   credit balance (`brand_studio_allowances`) directly.
 * - Every token resolution re-verifies live `studioSeat(sql, user_id, organization_id, { requireSelfStudio: true })`,
 *   so Morphic/sandboxed organizations, `generative_media`-denied organizations, and removed members
 *   immediately receive `404`.
 */
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { requireCreate, StudioDenied, studioSeat, type StudioSeat } from '@/lib/brand-studio/access';
import type { StudioFailure } from '@/lib/brand-studio/contracts';
import { failure, guarded } from '@/lib/brand-studio/outcome';
import { MCP_CLIENT_IDS, type McpTokenWire } from './clients';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RAW_TOKEN_PATTERN = /^twmcp_[0-9a-f]{48}$/;
const iso = (v: Date | string | null | undefined): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();

interface McpTokenRow {
  id: string;
  organization_id: string;
  user_id: string;
  client_id: string;
  label: string;
  token_prefix: string;
  token_hash: string;
  oauth_code_jti?: string | null;
  last_used_at: Date | string | null;
  revoked_at: Date | string | null;
  created_at: Date | string;
}

export function hashMcpToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export function generateRawMcpToken(): { rawToken: string; tokenPrefix: string; tokenHash: string } {
  const hex = randomBytes(24).toString('hex');
  const rawToken = `twmcp_${hex}`;
  return {
    rawToken,
    tokenPrefix: rawToken.slice(0, 14),
    tokenHash: hashMcpToken(rawToken),
  };
}

function tokenWireOf(row: McpTokenRow): McpTokenWire {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    label: String(row.label),
    tokenPrefix: String(row.token_prefix),
    lastUsedAt: iso(row.last_used_at),
    createdAt: iso(row.created_at)!,
  };
}

export const McpTokenCreateSchema = z.object({
  organizationId: z.uuid(),
  clientId: z.string().trim().min(1).max(40).default('claude'),
  label: z.string().trim().min(1).max(80).optional(),
  oauthCodeJti: z.string().trim().min(8).max(64).optional(),
});

export const McpTokenRevokeSchema = z.object({
  organizationId: z.uuid(),
  tokenId: z.uuid(),
});

export interface McpTokensListResult {
  ok: true;
  canCreate: boolean;
  tokens: McpTokenWire[];
}

export interface McpTokenMintedResult {
  ok: true;
  /** Raw `twmcp_<48 hex>` key — shown once to the member and never stored. */
  token: string;
  record: McpTokenWire;
}

export interface McpTokenRevokedResult {
  ok: true;
}

export async function listMcpTokens(
  sql: SqlRunner,
  viewer: Viewer,
  organizationId: string,
): Promise<McpTokensListResult | StudioFailure> {
  if (!UUID.test(organizationId)) return failure('not_found');
  return guarded(() =>
    sql.transaction(async (tx) => {
      const seat = await studioSeat(tx, viewer.userId, organizationId, { requireSelfStudio: true, requireAgentAccess: true });
      const reg = (await tx.query<{ t: string | null }>("select to_regclass('public.brand_studio_mcp_tokens')::text as t")).rows[0];
      if (!reg?.t) {
        return {
          ok: true as const,
          canCreate: seat.canCreate,
          tokens: [],
        };
      }
      const rows = (
        await tx.query<McpTokenRow>(
          `select * from brand_studio_mcp_tokens
            where organization_id = $1 and user_id = $2 and revoked_at is null
            order by created_at desc, id limit 50`,
          [organizationId, seat.userId],
        )
      ).rows;
      return {
        ok: true as const,
        canCreate: seat.canCreate,
        tokens: rows.map(tokenWireOf),
      };
    }),
  );
}

export async function mintMcpToken(
  sql: SqlRunner,
  viewer: Viewer,
  raw: unknown,
): Promise<McpTokenMintedResult | StudioFailure> {
  const parsed = McpTokenCreateSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  const safeClientId = (MCP_CLIENT_IDS as readonly string[]).includes(v.clientId)
    ? v.clientId
    : v.clientId.replace(/[^a-z0-9_-]/gi, '-').slice(0, 40) || 'claude';
  const defaultLabel = `${safeClientId} 연결 키`;
  const cleanLabel = (v.label?.trim() || defaultLabel).slice(0, 80);

  return guarded(() =>
    sql.transaction(async (tx) => {
      const seat = await studioSeat(tx, viewer.userId, v.organizationId, { requireSelfStudio: true, requireAgentAccess: true });
      requireCreate(seat);
      const { rawToken, tokenPrefix, tokenHash } = generateRawMcpToken();
      const row = (
        await tx.query<McpTokenRow>(
          `insert into brand_studio_mcp_tokens (organization_id, user_id, client_id, label, token_prefix, token_hash, oauth_code_jti)
           values ($1, $2, $3, $4, $5, $6, $7)
           returning *`,
          [v.organizationId, seat.userId, safeClientId, cleanLabel, tokenPrefix, tokenHash, v.oauthCodeJti ?? null],
        )
      ).rows[0]!;
      return {
        ok: true as const,
        token: rawToken,
        record: tokenWireOf(row),
      };
    }),
  );
}

export async function revokeMcpToken(
  sql: SqlRunner,
  viewer: Viewer,
  raw: unknown,
): Promise<McpTokenRevokedResult | StudioFailure> {
  const parsed = McpTokenRevokeSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  return guarded(() =>
    sql.transaction(async (tx) => {
      const seat = await studioSeat(tx, viewer.userId, v.organizationId, { requireSelfStudio: true, requireAgentAccess: true });
      requireCreate(seat);
      const row = (
        await tx.query<McpTokenRow>('select * from brand_studio_mcp_tokens where id = $1 and organization_id = $2', [
          v.tokenId,
          v.organizationId,
        ])
      ).rows[0];
      if (!row) throw new StudioDenied('not_found');
      if (row.user_id !== seat.userId && seat.role !== 'owner') throw new StudioDenied('forbidden');
      await tx.query(
        'update brand_studio_mcp_tokens set revoked_at = now() where id = $1 and revoked_at is null',
        [v.tokenId],
      );
      return { ok: true as const };
    }),
  );
}

/**
 * Extracts `twmcp_...` strictly from `Authorization: Bearer ...` header or `?token=...` query parameter.
 * Browser session cookies are NEVER consulted.
 */
export function extractMcpBearerToken(url: URL, headers: Headers): string | null {
  const auth = headers.get('authorization');
  if (auth) {
    const match = /^Bearer\s+(\S+)\s*$/i.exec(auth.trim());
    if (match?.[1]) return match[1].trim();
  }
  const queryToken = url.searchParams.get('token')?.trim();
  if (queryToken) return queryToken;
  return null;
}

export type McpAuthOutcome =
  | {
      ok: true;
      tokenId: string;
      clientId: string;
      seat: StudioSeat;
      viewer: Viewer;
    }
  | {
      ok: false;
      status: 401 | 403 | 404;
      code: 'missing_token' | 'invalid_token' | 'forbidden' | 'not_found';
    };

export async function authenticateMcpToken(sql: SqlRunner, rawToken: string | null): Promise<McpAuthOutcome> {
  if (!rawToken) {
    return { ok: false, status: 401, code: 'missing_token' };
  }
  if (!RAW_TOKEN_PATTERN.test(rawToken)) {
    return { ok: false, status: 401, code: 'invalid_token' };
  }

  const tokenHash = hashMcpToken(rawToken);
  let row: McpTokenRow | undefined;
  try {
    row = (
      await sql.query<McpTokenRow>('select * from brand_studio_mcp_tokens where token_hash = $1', [tokenHash])
    ).rows[0];
  } catch (error) {
    if ((error as { code?: string } | null)?.code === '42P01') {
      return { ok: false, status: 401, code: 'invalid_token' };
    }
    throw error;
  }
  if (!row || row.revoked_at !== null) {
    return { ok: false, status: 401, code: 'invalid_token' };
  }

  try {
    const seat = await sql.transaction(async (tx) => {
      const verified = await studioSeat(tx, row.user_id, row.organization_id, { requireSelfStudio: true, requireAgentAccess: true });
      requireCreate(verified);
      await tx.query('update brand_studio_mcp_tokens set last_used_at = now() where id = $1', [row.id]);
      return verified;
    });

    const profile = (
      await sql.query<{ email: string | null; locale: string | null }>(
        'select email, locale from profiles where id = $1',
        [seat.userId],
      )
    ).rows[0];

    const viewer: Viewer = {
      userId: seat.userId,
      isAdmin: false,
      tier: 'free',
      email: profile?.email ?? null,
      locale: profile?.locale === 'en' ? 'en' : 'ko',
    };

    return {
      ok: true,
      tokenId: String(row.id),
      clientId: String(row.client_id),
      seat,
      viewer,
    };
  } catch (error) {
    if (error instanceof StudioDenied) {
      if (error.code === 'forbidden') return { ok: false, status: 403, code: 'forbidden' };
      return { ok: false, status: 404, code: 'not_found' };
    }
    throw error;
  }
}
