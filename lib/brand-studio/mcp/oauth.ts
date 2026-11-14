/**
 * OAuth 2.1 Discovery, Dynamic Client Registration (RFC 7591), PKCE S256 Authorization Code, and
 * Token Exchange for Remote Streamable HTTP MCP (`docs/STUDIO-PRO-SUITE-V4.md` §1.5).
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { normalizeMcpOrigin } from './clients';
import { mintMcpToken } from './tokens';

const CODE_TTL_SECONDS = 300;

function oauthSigningSecret(env: Record<string, string | undefined> = process.env): string {
  const dedicated = env.MCP_OAUTH_SECRET?.trim();
  if (dedicated && dedicated.length >= 32) {
    return dedicated;
  }
  const srvKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (srvKey && srvKey.length >= 16) {
    return createHmac('sha256', srvKey).update('twings-mcp-oauth-signing-v1').digest('hex');
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('mcp_oauth_secret_missing');
  }
  return 'twings-local-dev-mcp-oauth-signing-key-not-for-prod';
}

function hmacB64Url(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function verifySignedToken<T>(raw: string, prefix: string, secret: string): T | null {
  if (!raw.startsWith(prefix)) return null;
  const body = raw.slice(prefix.length);
  const dot = body.indexOf('.');
  if (dot <= 0) return null;
  const payloadB64 = body.slice(0, dot);
  const sigB64 = body.slice(dot + 1);
  const expected = hmacB64Url(payloadB64, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(sigB64);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

export function isAllowedMcpRedirectUri(rawUri: string): boolean {
  if (!rawUri || rawUri.length > 512) return false;
  try {
    const u = new URL(rawUri);
    if (u.protocol === 'https:') return true;
    if (u.protocol === 'http:') {
      return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
    }
    return ['claude:', 'cursor:', 'chatgpt:', 'vscode:', 'codex:'].includes(u.protocol);
  } catch {
    return false;
  }
}

/**
 * Next.js `NextURL` rewrites `127.0.0.1` to `localhost` inside query parameters while JSON/form
 * bodies preserve `127.0.0.1`. Per RFC 8252 §7.3, treat `http://127.0.0.1:<port>/<path>` and
 * `http://localhost:<port>/<path>` with identical port, path, and query as equivalent loopback URIs.
 */
function redirectUrisMatch(registeredUri: string, candidateUri: string): boolean {
  if (registeredUri === candidateUri) return true;
  try {
    const a = new URL(registeredUri);
    const b = new URL(candidateUri);
    const isLoopbackHost = (h: string) => h === '127.0.0.1' || h === 'localhost';
    return (
      a.protocol === 'http:' &&
      b.protocol === 'http:' &&
      isLoopbackHost(a.hostname) &&
      isLoopbackHost(b.hostname) &&
      a.port === b.port &&
      a.pathname === b.pathname &&
      a.search === b.search
    );
  } catch {
    return false;
  }
}

/* ----------------------------------------------------- discovery metadata */

export function buildOAuthProtectedResourceMetadata(origin?: string | null) {
  const base = normalizeMcpOrigin(origin);
  return {
    resource: `${base}/api/mcp`,
    authorization_servers: [base],
    bearer_methods_supported: ['header', 'query'],
    scopes_supported: ['mcp:tools', 'mcp:resources'],
    resource_name: 'TWINGS Brand Studio MCP',
  };
}

export function buildOAuthAuthorizationServerMetadata(origin?: string | null) {
  const base = normalizeMcpOrigin(origin);
  return {
    issuer: base,
    authorization_endpoint: `${base}/api/mcp/oauth/authorize`,
    token_endpoint: `${base}/api/mcp/oauth/token`,
    registration_endpoint: `${base}/api/mcp/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['mcp:tools', 'mcp:resources'],
  };
}

/* ------------------------------------------- dynamic client registration */

interface SignedClientPayload {
  n: string;
  u: string[];
  iat: number;
}

export function registerMcpOAuthClient(
  body: unknown,
  env: Record<string, string | undefined> = process.env,
): { ok: true; client: Record<string, unknown> } | { ok: false; error: string; description: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'invalid_client_metadata', description: 'JSON object body required.' };
  }
  const rec = body as Record<string, unknown>;
  const uris = Array.isArray(rec.redirect_uris)
    ? rec.redirect_uris.filter((u): u is string => typeof u === 'string' && isAllowedMcpRedirectUri(u)).slice(0, 8)
    : [];
  if (uris.length === 0) {
    return { ok: false, error: 'invalid_redirect_uri', description: 'At least one valid https or loopback redirect_uri is required.' };
  }
  const clientName =
    typeof rec.client_name === 'string' && rec.client_name.trim()
      ? rec.client_name.trim().slice(0, 60)
      : 'MCP Client';
  const iat = Math.floor(Date.now() / 1000);
  const payload: SignedClientPayload = { n: clientName, u: uris, iat };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = hmacB64Url(payloadB64, oauthSigningSecret(env));
  const clientId = `twc_${payloadB64}.${sig}`;

  return {
    ok: true,
    client: {
      client_id: clientId,
      client_id_issued_at: iat,
      client_name: clientName,
      redirect_uris: uris,
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
  };
}

export function verifyMcpClientAndRedirect(
  clientId: string,
  redirectUri: string,
  env: Record<string, string | undefined> = process.env,
): { ok: true; clientName: string } | { ok: false; error: string } {
  if (!clientId || clientId.length > 2048 || !isAllowedMcpRedirectUri(redirectUri)) {
    return { ok: false, error: 'invalid_request' };
  }
  if (!clientId.startsWith('twc_')) {
    return { ok: false, error: 'invalid_client' };
  }
  const parsed = verifySignedToken<SignedClientPayload>(clientId, 'twc_', oauthSigningSecret(env));
  if (!parsed || !Array.isArray(parsed.u) || !parsed.u.some((u) => redirectUrisMatch(u, redirectUri))) {
    return { ok: false, error: 'invalid_client' };
  }
  return { ok: true, clientName: parsed.n || 'MCP Client' };
}

/* ------------------------------------------- PKCE S256 authorization code */

interface SignedAuthCodePayload {
  uid: string;
  oid: string;
  cid: string;
  cname: string;
  ruri: string;
  cc: string;
  ccm: 'S256';
  exp: number;
  jti: string;
}

export function issueMcpAuthorizationCode(
  input: {
    userId: string;
    organizationId: string;
    clientId: string;
    clientName: string;
    redirectUri: string;
    codeChallenge: string;
    nowMs?: number;
  },
  env: Record<string, string | undefined> = process.env,
): string {
  const nowSec = Math.floor((input.nowMs ?? Date.now()) / 1000);
  const payload: SignedAuthCodePayload = {
    uid: input.userId,
    oid: input.organizationId,
    cid: input.clientId,
    cname: input.clientName.slice(0, 60),
    ruri: input.redirectUri,
    cc: input.codeChallenge,
    ccm: 'S256',
    exp: nowSec + CODE_TTL_SECONDS,
    jti: randomBytes(12).toString('hex'),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = hmacB64Url(payloadB64, oauthSigningSecret(env));
  return `twa_${payloadB64}.${sig}`;
}

export function computePkceS256Challenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

export type OAuthTokenExchangeOutcome =
  | {
      ok: true;
      access_token: string;
      token_type: 'Bearer';
      scope: string;
    }
  | {
      ok: false;
      status: 400 | 401 | 403 | 404;
      error: string;
      error_description: string;
    };

export async function exchangeMcpAuthorizationCode(
  sql: SqlRunner,
  params: {
    grant_type?: string | null;
    code?: string | null;
    code_verifier?: string | null;
    redirect_uri?: string | null;
    client_id?: string | null;
  },
  env: Record<string, string | undefined> = process.env,
): Promise<OAuthTokenExchangeOutcome> {
  if (params.grant_type !== 'authorization_code') {
    return { ok: false, status: 400, error: 'unsupported_grant_type', error_description: 'Only authorization_code is supported.' };
  }
  const code = params.code?.trim();
  const verifier = params.code_verifier?.trim();
  if (!code || !verifier || verifier.length < 43 || verifier.length > 128) {
    return { ok: false, status: 400, error: 'invalid_request', error_description: 'Valid code and PKCE code_verifier are required.' };
  }

  const secret = oauthSigningSecret(env);
  const decoded = verifySignedToken<SignedAuthCodePayload>(code, 'twa_', secret);
  if (!decoded) {
    return { ok: false, status: 400, error: 'invalid_grant', error_description: 'Invalid authorization code.' };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (decoded.exp <= nowSec) {
    return { ok: false, status: 400, error: 'invalid_grant', error_description: 'Authorization code expired or already used.' };
  }
  if (!params.redirect_uri || !redirectUrisMatch(decoded.ruri, params.redirect_uri)) {
    return { ok: false, status: 400, error: 'invalid_grant', error_description: 'redirect_uri mismatch.' };
  }
  if (!params.client_id || params.client_id !== decoded.cid) {
    return { ok: false, status: 400, error: 'invalid_client', error_description: 'client_id mismatch.' };
  }

  const computedChallenge = computePkceS256Challenge(verifier);
  const a = Buffer.from(computedChallenge);
  const b = Buffer.from(decoded.cc);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 400, error: 'invalid_grant', error_description: 'PKCE verification failed.' };
  }

  const viewer: Viewer = {
    userId: decoded.uid,
    isAdmin: false,
    tier: 'free',
    email: null,
    locale: 'ko',
  };

  const clientSlug = decoded.cname
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'oauth-client';

  const minted = await mintMcpToken(sql, viewer, {
    organizationId: decoded.oid,
    clientId: clientSlug,
    label: `${decoded.cname.slice(0, 48)} (OAuth)`,
    oauthCodeJti: decoded.jti,
  });

  if (!minted.ok) {
    if (minted.code === 'conflict') {
      return { ok: false, status: 400, error: 'invalid_grant', error_description: 'Authorization code expired or already used.' };
    }
    if (minted.code === 'forbidden') {
      return { ok: false, status: 403, error: 'access_denied', error_description: 'Insufficient studio permissions.' };
    }
    return { ok: false, status: 404, error: 'not_found', error_description: 'Not found.' };
  }

  return {
    ok: true,
    access_token: minted.token,
    token_type: 'Bearer',
    scope: 'mcp:tools mcp:resources',
  };
}
