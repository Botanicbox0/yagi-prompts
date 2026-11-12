/**
 * Multi-client MCP onboarding definitions & copyable snippet builders (`docs/STUDIO-PRO-SUITE-V4.md` §1.5).
 *
 * Client-safe: pure strings and configuration builders only (no node:*, no env, no db).
 */

export const MCP_CLIENT_IDS = [
  'claude',
  'claude-code',
  'chatgpt',
  'gemini',
  'cursor',
  'codex',
  'openclaw',
  'hermes',
] as const;
export type McpClientId = (typeof MCP_CLIENT_IDS)[number];

export interface McpClientTabSpec {
  id: McpClientId;
  label: string;
  dictKey: 'claude' | 'claudeCode' | 'chatgpt' | 'gemini' | 'cursor' | 'codex' | 'openclaw' | 'hermes';
  supportsBrowserOAuth: boolean;
  snippetLanguage: 'url' | 'bash' | 'json';
}

export const MCP_CLIENT_TABS: readonly McpClientTabSpec[] = [
  { id: 'claude', label: 'Claude', dictKey: 'claude', supportsBrowserOAuth: true, snippetLanguage: 'url' },
  { id: 'claude-code', label: 'Claude Code', dictKey: 'claudeCode', supportsBrowserOAuth: true, snippetLanguage: 'bash' },
  { id: 'chatgpt', label: 'ChatGPT', dictKey: 'chatgpt', supportsBrowserOAuth: true, snippetLanguage: 'url' },
  { id: 'gemini', label: 'Gemini', dictKey: 'gemini', supportsBrowserOAuth: false, snippetLanguage: 'json' },
  { id: 'cursor', label: 'Cursor', dictKey: 'cursor', supportsBrowserOAuth: false, snippetLanguage: 'json' },
  { id: 'codex', label: 'Codex (CLI)', dictKey: 'codex', supportsBrowserOAuth: false, snippetLanguage: 'bash' },
  { id: 'openclaw', label: 'OpenClaw', dictKey: 'openclaw', supportsBrowserOAuth: false, snippetLanguage: 'json' },
  { id: 'hermes', label: 'Hermes', dictKey: 'hermes', supportsBrowserOAuth: false, snippetLanguage: 'json' },
] as const;

export const DEFAULT_MCP_ORIGIN = 'https://brand.twings.app';

export function normalizeMcpOrigin(origin?: string | null): string {
  const trimmed = origin?.trim().replace(/\/+$/, '');
  return trimmed && /^https?:\/\//i.test(trimmed) ? trimmed : DEFAULT_MCP_ORIGIN;
}

export function buildMcpClientSnippet(clientId: McpClientId, rawToken?: string | null, origin?: string | null): string {
  const base = normalizeMcpOrigin(origin);
  const endpoint = `${base}/api/mcp`;
  const tok = rawToken?.trim() || '<TOKEN>';

  switch (clientId) {
    case 'claude':
    case 'chatgpt':
      return `${endpoint}?token=${tok}`;

    case 'claude-code':
      return `claude mcp add --transport http --scope user twings ${endpoint} --header "Authorization: Bearer ${tok}"`;

    case 'gemini':
      return JSON.stringify(
        {
          mcpServers: {
            twings: {
              httpUrl: endpoint,
              headers: {
                Authorization: `Bearer ${tok}`,
              },
            },
          },
        },
        null,
        2,
      );

    case 'cursor':
      return JSON.stringify(
        {
          mcpServers: {
            twings: {
              url: endpoint,
              headers: {
                Authorization: `Bearer ${tok}`,
              },
            },
          },
        },
        null,
        2,
      );

    case 'codex':
      return rawToken?.trim()
        ? `export TWINGS_MCP_TOKEN="${tok}"\ncodex mcp add twings --url ${endpoint} --bearer-token-env-var TWINGS_MCP_TOKEN`
        : `codex mcp add twings --url ${endpoint} --bearer-token-env-var TWINGS_MCP_TOKEN`;

    case 'openclaw':
      return JSON.stringify(
        {
          mcpServers: {
            twings: {
              type: 'streamable-http',
              url: endpoint,
              headers: {
                Authorization: `Bearer ${tok}`,
              },
            },
          },
        },
        null,
        2,
      );

    case 'hermes':
      return JSON.stringify(
        {
          mcp_servers: {
            twings: {
              transport: 'streamable_http',
              url: endpoint,
              headers: {
                Authorization: `Bearer ${tok}`,
              },
            },
          },
        },
        null,
        2,
      );
  }
}

export interface McpTokenWire {
  id: string;
  clientId: string;
  label: string;
  tokenPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}
