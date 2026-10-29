'use client';

import { useRef, useState } from 'react';
import { BUTTON, BUTTON_OUTLINE, FIELD, HINT } from './styles';

/**
 * docs/PLATFORM-2.0.md §20 — the Creative Studio's islands: the cover, the avatar, the selected works
 * and the agent (MCP) tokens. Each talks to one same-origin JSON route (/api/makers/works,
 * /api/makers/tokens); the server re-checks the creative on every call, and answers carry ids and
 * codes only. Files go up as the raw body, as the recipe editor's do (4 MB, type from the bytes).
 */

type Errors = Record<string, string>;
const errorText = (errors: Errors, code: string | undefined) => (code && errors[code]) || errors.unavailable || code || '';

async function call<T>(url: string, init: RequestInit): Promise<{ ok: true; body: T } | { ok: false; code: string }> {
  try {
    const response = await fetch(url, { credentials: 'same-origin', ...init });
    const body = (await response.json().catch(() => ({}))) as T & { code?: string };
    return response.ok ? { ok: true, body } : { ok: false, code: body.code ?? 'unavailable' };
  } catch { return { ok: false, code: 'unavailable' }; }
}

export function AvatarUpload({ handle, version, name, copy }: {
  handle: string | null; version: string | null; name: string | null;
  copy: { label: string; hint: string; upload: string; remove: string; errors: Errors };
}) {
  const [current, setCurrent] = useState(version);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const src = current ? (handle ? `/api/makers/media/avatar-${handle}?v=${current}` : `/api/makers/media/avatar-me?v=${current}`) : null;
  const initial = [...(name ?? handle ?? '@').trim()][0]?.toUpperCase() ?? '@';

  async function upload(file: File) {
    setBusy(true); setError(null);
    const result = await call<{ avatarVersion: string }>('/api/makers/works?kind=avatar', { method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
    setBusy(false);
    if (result.ok) setCurrent(result.body.avatarVersion); else setError(errorText(copy.errors, result.code));
  }
  async function remove() {
    setBusy(true); setError(null);
    const result = await call('/api/makers/works?kind=avatar', { method: 'DELETE' });
    setBusy(false);
    if (result.ok) setCurrent(null); else setError(errorText(copy.errors, result.code));
  }

  return (
    <div data-creative-avatar-upload className="flex flex-wrap items-center gap-4">
      <span className="inline-flex size-20 items-center justify-center overflow-hidden rounded-full bg-on-surface/10 text-2xl font-black">
        {/* eslint-disable-next-line @next/next/no-img-element -- the creative's own avatar through the gateway */}
        {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <span aria-hidden="true">{initial}</span>}
      </span>
      <div className="space-y-2">
        <p className="text-sm font-medium">{copy.label}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => input.current?.click()} className={`${BUTTON_OUTLINE} min-h-10 px-4 py-2`}>{copy.upload}</button>
          {current && <button type="button" disabled={busy} onClick={remove} className="inline-flex min-h-10 items-center px-2 text-sm underline underline-offset-4 disabled:opacity-40">{copy.remove}</button>}
        </div>
        <span className={HINT}>{copy.hint}</span>
        {error && <p role="alert" className="text-sm text-accent">{error}</p>}
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file); }} />
      </div>
    </div>
  );
}

/**
 * The profile banner (0071), previewed at the public page's desktop shape (3:1). Upload, replace and
 * remove go to the same route as the avatar; the server crops to 2:1 and strips the metadata.
 */
export function CoverUpload({ handle, version, copy }: {
  handle: string | null; version: string | null;
  copy: { label: string; hint: string; upload: string; replace: string; remove: string; errors: Errors };
}) {
  const [current, setCurrent] = useState(version);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const src = current ? (handle ? `/api/makers/media/cover-${handle}?v=${current}` : `/api/makers/media/cover-me?v=${current}`) : null;

  async function upload(file: File) {
    setBusy(true); setError(null);
    const result = await call<{ coverVersion: string }>('/api/makers/works?kind=cover', { method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
    setBusy(false);
    if (result.ok) setCurrent(result.body.coverVersion); else setError(errorText(copy.errors, result.code));
  }
  async function remove() {
    setBusy(true); setError(null);
    const result = await call('/api/makers/works?kind=cover', { method: 'DELETE' });
    setBusy(false);
    if (result.ok) setCurrent(null); else setError(errorText(copy.errors, result.code));
  }

  return (
    <div data-creative-cover-upload className="space-y-3">
      <p className="text-sm font-medium">{copy.label}</p>
      <div aria-busy={busy} className="relative aspect-[3/1] overflow-hidden rounded-2xl border border-hairline bg-on-surface/[0.04]">
        {/* eslint-disable-next-line @next/next/no-img-element -- the creative's own cover through the gateway */}
        {src && <img src={src} alt="" className="h-full w-full object-cover" />}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className={`${BUTTON_OUTLINE} min-h-10 px-4 py-2`}>{current ? copy.replace : copy.upload}</button>
        {current && <button type="button" disabled={busy} onClick={remove} className="inline-flex min-h-10 items-center px-2 text-sm underline underline-offset-4 disabled:opacity-40">{copy.remove}</button>}
      </div>
      <span className={HINT}>{copy.hint}</span>
      {error && <p role="alert" className="text-sm text-accent">{error}</p>}
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file); }} />
    </div>
  );
}

export interface StudioWork { id: string; kind: 'image' | 'video'; title: string | null; caption: string | null; linkUrl: string | null }
export interface WorksCopy {
  heading: string; lede: string; hint: string; upload: string; uploading: string; count: string; empty: string; titleLabel: string; captionLabel: string;
  linkLabel: string; save: string; saved: string; remove: string; moveUp: string; moveDown: string; errors: Errors;
}

export function WorksManager({ initial, copy }: { initial: StudioWork[]; copy: WorksCopy }) {
  const [works, setWorks] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function upload(files: FileList) {
    setError(null);
    for (const file of Array.from(files)) {
      setBusy('upload');
      const result = await call<{ work: StudioWork; unchanged: boolean }>('/api/makers/works?kind=work', { method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
      if (!result.ok) { setError(errorText(copy.errors, result.code)); break; }
      const work = result.body.work;
      setWorks((list) => (list.some((item) => item.id === work.id) ? list : [...list, work]));
    }
    setBusy(null);
  }
  async function save(id: string, form: HTMLFormElement) {
    const data = new FormData(form);
    setBusy(id); setError(null);
    const result = await call<{ work: StudioWork }>('/api/makers/works', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, title: data.get('title'), caption: data.get('caption'), link: data.get('link') }) });
    setBusy(null);
    if (result.ok) { setWorks((list) => list.map((item) => (item.id === id ? result.body.work : item))); setSavedId(id); setTimeout(() => setSavedId(null), 1600); }
    else setError(errorText(copy.errors, result.code));
  }
  async function remove(id: string) {
    setBusy(id); setError(null);
    const result = await call(`/api/makers/works?id=${id}`, { method: 'DELETE' });
    setBusy(null);
    if (result.ok) setWorks((list) => list.filter((item) => item.id !== id)); else setError(errorText(copy.errors, result.code));
  }
  async function move(index: number, by: -1 | 1) {
    const next = [...works];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item!);
    setWorks(next); setError(null);
    const result = await call<{ works: StudioWork[] }>('/api/makers/works', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order: next.map((work) => work.id) }) });
    if (!result.ok) { setWorks(works); setError(errorText(copy.errors, result.code)); }
  }

  return (
    <div data-creative-works-manager className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" disabled={busy !== null || works.length >= 12} onClick={() => input.current?.click()} className={BUTTON}>{busy === 'upload' ? copy.uploading : copy.upload}</button>
        <span className="font-mono text-xs opacity-60">{copy.count.replace('{n}', String(works.length))}</span>
        <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" hidden onChange={(event) => { const files = event.target.files; if (files?.length) void upload(files); event.target.value = ''; }} />
      </div>
      <span className={HINT}>{copy.hint}</span>
      {error && <p role="alert" className="rounded-xl border border-accent p-3 text-sm">{error}</p>}
      {works.length === 0 ? <p className="text-sm opacity-60">{copy.empty}</p> : (
        <ol className="grid gap-4 sm:grid-cols-2">
          {works.map((work, index) => (
            <li key={work.id} data-studio-work={work.id} className="overflow-hidden rounded-2xl border border-hairline">
              <div className="relative aspect-[4/3] bg-on-surface/5">
                {work.kind === 'image'
                  // eslint-disable-next-line @next/next/no-img-element -- the creative's own work through the gateway
                  ? <img src={`/api/makers/media/${work.id}`} alt="" className="h-full w-full object-cover" />
                  : <video src={`/api/makers/media/${work.id}#t=0.1`} muted playsInline preload="metadata" className="h-full w-full object-cover" />}
                <span className="absolute top-2 left-2 rounded-md bg-black/70 px-2 py-0.5 font-mono text-xs text-white">{index + 1}</span>
              </div>
              <form className="space-y-2 p-3" onSubmit={(event) => { event.preventDefault(); void save(work.id, event.currentTarget); }}>
                <input name="title" defaultValue={work.title ?? ''} maxLength={80} placeholder={copy.titleLabel} aria-label={copy.titleLabel} className={`${FIELD} mt-0 min-h-10 py-2`} />
                <textarea name="caption" defaultValue={work.caption ?? ''} maxLength={280} rows={2} placeholder={copy.captionLabel} aria-label={copy.captionLabel} className={`${FIELD} mt-0 py-2`} />
                <input name="link" defaultValue={work.linkUrl ?? ''} inputMode="url" placeholder={copy.linkLabel} aria-label={copy.linkLabel} className={`${FIELD} mt-0 min-h-10 py-2`} />
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button type="submit" disabled={busy === work.id} className="inline-flex min-h-10 items-center rounded-full bg-on-surface px-4 text-xs text-surface disabled:opacity-40">{savedId === work.id ? copy.saved : copy.save}</button>
                  <button type="button" disabled={index === 0} onClick={() => void move(index, -1)} aria-label={copy.moveUp} className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-full border border-hairline text-sm disabled:opacity-30">↑</button>
                  <button type="button" disabled={index === works.length - 1} onClick={() => void move(index, 1)} aria-label={copy.moveDown} className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-full border border-hairline text-sm disabled:opacity-30">↓</button>
                  <button type="button" disabled={busy === work.id} onClick={() => void remove(work.id)} className="ml-auto inline-flex min-h-10 items-center px-2 text-xs underline underline-offset-4 disabled:opacity-40">{copy.remove}</button>
                </div>
              </form>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export interface StudioToken { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null }
export interface ConnectCopy {
  heading: string; lede: string; nameLabel: string; namePlaceholder: string; create: string; creating: string; created: string; copy: string; copied: string;
  revoke: string; empty: string; lastUsed: string; neverUsed: string; limit: string; setupHeading: string; endpoint: string; tools: string; errors: Errors;
}

function CopyLine({ text, label, done }: { text: string; label: string; done: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-2 rounded-xl bg-black p-3 text-white">
      <code className="min-w-0 flex-1 overflow-x-auto font-mono text-[0.75rem] leading-relaxed whitespace-pre">{text}</code>
      <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* visible anyway */ } }} className="shrink-0 rounded-full bg-white/15 px-3 py-1 text-xs hover:bg-white/25">{copied ? done : label}</button>
    </div>
  );
}

export function McpConnect({ initial, endpoint, locale, copy }: { initial: StudioToken[]; endpoint: string; locale: string; copy: ConnectCopy }) {
  const [tokens, setTokens] = useState(initial);
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = fresh ?? '<YOUR_TOKEN>';
  const date = (value: string) => new Date(value).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });

  async function create() {
    setBusy(true); setError(null);
    const result = await call<{ token: string; record: StudioToken }>('/api/makers/tokens', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    setBusy(false);
    if (result.ok) { setFresh(result.body.token); setTokens((list) => [result.body.record, ...list]); setName(''); }
    else setError(errorText(copy.errors, result.code));
  }
  async function revoke(id: string) {
    setError(null);
    const result = await call(`/api/makers/tokens?id=${id}`, { method: 'DELETE' });
    if (result.ok) setTokens((list) => list.filter((token) => token.id !== id)); else setError(errorText(copy.errors, result.code));
  }

  return (
    <div data-creative-mcp className="space-y-5">
      <p className="text-sm leading-relaxed opacity-75">{copy.tools}</p>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); void create(); }}>
        <label className="block min-w-[14rem] flex-1 text-sm font-medium">
          {copy.nameLabel}
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} placeholder={copy.namePlaceholder} className={FIELD} />
        </label>
        <button type="submit" disabled={busy || !name.trim() || tokens.length >= 5} className={BUTTON}>{busy ? copy.creating : copy.create}</button>
      </form>
      <span className={HINT}>{copy.limit}</span>
      {error && <p role="alert" className="rounded-xl border border-accent p-3 text-sm">{error}</p>}
      {fresh && (
        <div data-creative-token-fresh className="space-y-2 rounded-xl border border-accent p-4">
          <p className="text-sm font-medium">{copy.created}</p>
          <CopyLine text={fresh} label={copy.copy} done={copy.copied} />
        </div>
      )}
      {tokens.length === 0 ? <p className="text-sm opacity-60">{copy.empty}</p> : (
        <ul className="divide-y divide-hairline rounded-xl border border-hairline">
          {tokens.map((token) => (
            <li key={token.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="min-w-0"><span className="font-medium">{token.name}</span> <span className="font-mono text-xs opacity-60">{token.prefix}…</span></span>
              <span className="text-xs opacity-60">{token.lastUsedAt ? copy.lastUsed.replace('{date}', date(token.lastUsedAt)) : copy.neverUsed}</span>
              <button type="button" onClick={() => void revoke(token.id)} className="inline-flex min-h-9 items-center text-xs underline underline-offset-4">{copy.revoke}</button>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-3">
        <p className="text-sm font-semibold">{copy.setupHeading}</p>
        <p className="text-xs opacity-70">{copy.endpoint}: <span className="font-mono">{endpoint}</span></p>
        <p className="text-xs font-medium opacity-80">Claude Code</p>
        <CopyLine text={`claude mcp add --transport http twings ${endpoint} --header "Authorization: Bearer ${shown}"`} label={copy.copy} done={copy.copied} />
        <p className="text-xs font-medium opacity-80">Cursor · ~/.cursor/mcp.json</p>
        <CopyLine text={JSON.stringify({ mcpServers: { twings: { url: endpoint, headers: { Authorization: `Bearer ${shown}` } } } }, null, 2)} label={copy.copy} done={copy.copied} />
        <p className="text-xs font-medium opacity-80">Codex · ~/.codex/config.toml</p>
        <CopyLine text={`[mcp_servers.twings]\nurl = "${endpoint}"\nhttp_headers = { Authorization = "Bearer ${shown}" }`} label={copy.copy} done={copy.copied} />
      </div>
    </div>
  );
}
