'use client';

import { useState } from 'react';
import {
  buildMcpClientSnippet,
  DEFAULT_MCP_ORIGIN,
  MCP_CLIENT_TABS,
  normalizeMcpOrigin,
  type McpClientId,
  type McpTokenWire,
} from '@/lib/brand-studio/mcp/clients';
import type { StudioWorkflowsCopy } from '@/messages/studio-workflows';
import styles from './workflows.module.css';

export interface McpConnectModalProps {
  open: boolean;
  onClose: () => void;
  organizationId: string;
  canCreate: boolean;
  locale: 'ko' | 'en';
  mcpOrigin?: string;
  copy: StudioWorkflowsCopy['mcp'];
  errorCopy: StudioWorkflowsCopy['errors'];
  initialTokens: McpTokenWire[];
}

function formatShortDate(isoString: string | null, locale: 'ko' | 'en'): string | null {
  if (!isoString) return null;
  try {
    return new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(isoString));
  } catch {
    return isoString.slice(0, 10);
  }
}

export function McpConnectModal({
  open,
  onClose,
  organizationId,
  canCreate,
  locale,
  mcpOrigin = DEFAULT_MCP_ORIGIN,
  copy,
  errorCopy,
  initialTokens,
}: McpConnectModalProps) {
  const [selectedClient, setSelectedClient] = useState<McpClientId>('claude');
  const [tokens, setTokens] = useState<McpTokenWire[]>(initialTokens);
  const [labelInput, setLabelInput] = useState('');
  const [mintedRawToken, setMintedRawToken] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [copiedTarget, setCopiedTarget] = useState<'snippet' | 'oauth' | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!open) return null;

  const activeSpec = MCP_CLIENT_TABS.find((t) => t.id === selectedClient) ?? MCP_CLIENT_TABS[0]!;
  const clientCopy = copy.clients[activeSpec.dictKey];
  const baseOrigin = normalizeMcpOrigin(mcpOrigin);
  const oauthServerUrl = `${baseOrigin}/api/mcp`;
  const snippet = buildMcpClientSnippet(selectedClient, mintedRawToken, baseOrigin);

  async function copyText(text: string, target: 'snippet' | 'oauth') {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedTarget(target);
      window.setTimeout(() => {
        setCopiedTarget((prev) => (prev === target ? null : prev));
      }, 1800);
    } catch {
      // Clipboard blocked in non-secure test contexts; ignore gracefully.
    }
  }

  async function handleMintToken() {
    if (!canCreate || minting) return;
    setMinting(true);
    setErrorMsg(null);
    try {
      const response = await fetch('/api/brand-studio/mcp-tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          op: 'create',
          organizationId,
          clientId: selectedClient,
          label: labelInput.trim() || `${activeSpec.label}`,
        }),
      });
      const data = (await response.json()) as
        | { ok: true; token: string; record: McpTokenWire }
        | { ok: false; code?: string };
      if (!response.ok || !data.ok) {
        setErrorMsg(data && !data.ok && data.code === 'forbidden' ? errorCopy.forbidden : errorCopy.failed);
        return;
      }
      setMintedRawToken(data.token);
      setTokens((prev) => [data.record, ...prev.filter((t) => t.id !== data.record.id)]);
      setLabelInput('');
    } catch {
      setErrorMsg(errorCopy.failed);
    } finally {
      setMinting(false);
    }
  }

  async function handleRevokeToken(tokenId: string) {
    if (!canCreate || revokingId) return;
    setRevokingId(tokenId);
    setErrorMsg(null);
    try {
      const response = await fetch('/api/brand-studio/mcp-tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          op: 'revoke',
          organizationId,
          tokenId,
        }),
      });
      if (!response.ok) {
        setErrorMsg(errorCopy.failed);
        return;
      }
      setTokens((prev) => prev.filter((t) => t.id !== tokenId));
    } catch {
      setErrorMsg(errorCopy.failed);
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div
      className={styles.modalBackdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mcp-connect-modal-title"
      data-mcp-connect-modal
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.modalDialog}>
        <div className={styles.modalHeader}>
          <div>
            <h2 id="mcp-connect-modal-title" className={styles.modalTitle}>
              {copy.modalTitle}
            </h2>
            <p className={styles.modalLead}>{copy.modalLead}</p>
          </div>
          <button type="button" className={styles.secondaryBtn} onClick={onClose}>
            {copy.close}
          </button>
        </div>

        {/* Client selector pills */}
        <div className={styles.clientTabs} role="tablist">
          {MCP_CLIENT_TABS.map((tab) => {
            const active = tab.id === selectedClient;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-mcp-client-tab={tab.id}
                className={`${styles.clientPill} ${active ? styles.clientPillActive : ''}`}
                onClick={() => setSelectedClient(tab.id)}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {errorMsg && <div className={styles.errorBanner}>{errorMsg}</div>}

        {/* 1-click personal key minting */}
        <div className={styles.surfaceBlock}>
          <div>
            <p className={styles.sectionLabel}>{copy.tokenSectionTitle}</p>
            <p className={styles.resultBody}>{copy.tokenSectionLead}</p>
          </div>
          <div className={styles.builderForm}>
            <input
              type="text"
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              placeholder={copy.tokenLabelPlaceholder}
              maxLength={80}
              className={styles.builderInput}
              disabled={!canCreate}
            />
            <button
              type="button"
              data-mcp-mint-token
              className={styles.primaryCta}
              disabled={!canCreate || minting}
              onClick={handleMintToken}
            >
              {minting ? copy.minting : copy.mintCta}
            </button>
          </div>
          {mintedRawToken && (
            <p className={styles.resultTitle} data-mcp-minted-notice>
              {copy.mintedNotice}
            </p>
          )}
        </div>

        {/* 1-2-3 Steps + Pre-interpolated Copyable Snippet */}
        <div className={styles.surfaceBlock}>
          <div className={styles.badgeRow}>
            <span className={styles.sectionLabel} style={{ margin: 0 }}>
              {copy.stepsHeading} · {activeSpec.label}
            </span>
            <span className={styles.badge}>{clientCopy.subtitle}</span>
          </div>

          <ol className={styles.stepsList}>
            <li className={styles.stepRow}>
              <span className={styles.indexPill}>1</span>
              <span>{clientCopy.step1}</span>
            </li>
            <li className={styles.stepRow}>
              <span className={styles.indexPill}>2</span>
              <span>{clientCopy.step2}</span>
            </li>
            <li className={styles.stepRow}>
              <span className={styles.indexPill}>3</span>
              <span>{clientCopy.step3}</span>
            </li>
          </ol>

          <div className={styles.codeBox}>
            <div className={styles.codeTop}>
              <span className={styles.codeLang}>{activeSpec.snippetLanguage}</span>
              <button
                type="button"
                className={styles.copyBtn}
                data-mcp-copy-snippet
                onClick={() => copyText(snippet, 'snippet')}
              >
                {copiedTarget === 'snippet' ? copy.copiedButton : copy.copyButton}
              </button>
            </div>
            <pre className={styles.codePre} data-mcp-snippet>
              {snippet}
            </pre>
          </div>

          {activeSpec.supportsBrowserOAuth && (
            <div className={styles.tokenRow}>
              <div className={styles.tokenMeta}>
                <strong>{copy.oauthBadge}</strong>
                <span className={styles.monoText}>
                  {copy.oauthUrlLabel}: {oauthServerUrl}
                </span>
              </div>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => copyText(oauthServerUrl, 'oauth')}
              >
                {copiedTarget === 'oauth' ? copy.copiedButton : copy.copyButton}
              </button>
            </div>
          )}
        </div>

        {/* Active Tokens List */}
        <div className={styles.surfaceBlock}>
          <p className={styles.sectionLabel} style={{ margin: 0 }}>
            {copy.activeKeysHeading}
          </p>
          {tokens.length === 0 ? (
            <p className={styles.resultBody}>{copy.noActiveKeys}</p>
          ) : (
            tokens.map((tok) => {
              const formattedUsed = formatShortDate(tok.lastUsedAt, locale);
              return (
                <div key={tok.id} className={styles.tokenRow} data-mcp-token-row={tok.id}>
                  <div className={styles.tokenMeta}>
                    <strong>
                      {tok.label} <span className={styles.monoText}>({tok.tokenPrefix}…)</span>
                    </strong>
                    <span className={styles.metaNums}>
                      {formattedUsed ? copy.lastUsed.replace('{date}', formattedUsed) : copy.neverUsed}
                    </span>
                  </div>
                  {canCreate && (
                    <button
                      type="button"
                      data-mcp-revoke-token={tok.id}
                      className={styles.secondaryBtn}
                      disabled={revokingId === tok.id}
                      onClick={() => handleRevokeToken(tok.id)}
                    >
                      {revokingId === tok.id ? copy.revoking : copy.revokeAction}
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
