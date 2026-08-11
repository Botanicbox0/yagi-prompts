import type { ReactNode } from 'react';
import type { ShapedAssetRef, ShapedBlock, ShapedBlockContent } from '@/lib/content/shape';
import type { BlockKind } from '@/lib/content/schemas';
import { interpolate, localize } from '@/lib/i18n/format';
import { TextSwap } from '@/components/ui/text-swap';
import { CopyButton } from './copy-button';
import { Markdown } from './markdown';
import type { PlaybookLabels } from './labels';

/**
 * PLAN §6.1 — the six block renderers, one per content contract, and §5.5's locked variant.
 *
 * Every renderer is a pure synchronous function of (shaped block, labels, locale). It receives
 * ONLY what the shaper decided to emit: there is no `visibility` branch inside a renderer and no
 * way to reach the original payload from here, because a gated block never arrives with content at
 * all — `{ locked: true, kind }` is the whole object (lib/content/shape.ts).
 *
 * §5.5, verbatim: locked blocks "keep full chrome (kind label, frame) + flat panel: blue lock
 * glyph, 'Unlock every prompt — $9/mo', text-swap hover CTA". No teaser, no blur, no ghost text.
 */

// ---------------------------------------------------------------------------
// chrome
// ---------------------------------------------------------------------------

function BlockShell({
  kind,
  id,
  locked,
  label,
  action,
  children,
}: {
  kind: BlockKind;
  id: string;
  locked: boolean;
  label: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <article
      id={`block-${id}`}
      data-block-kind={kind}
      data-locked={locked ? 'true' : 'false'}
      className="border border-hairline"
    >
      <header className="flex items-center justify-between gap-4 border-b border-hairline px-4 py-2.5">
        <span className="font-label text-eyebrow uppercase opacity-60">{label}</span>
        {action}
      </header>
      <div className="p-4 sm:p-5">{children}</div>
    </article>
  );
}

function LockGlyph() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="text-accent h-6 w-6 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="4" y="10" width="16" height="10" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// locked (§5.5)
// ---------------------------------------------------------------------------

export function LockedBlock({
  block,
  locale,
  labels,
}: {
  block: Extract<ShapedBlock, { locked: true }>;
  locale: string;
  labels: PlaybookLabels;
}) {
  const kindLabel = labels.kinds[block.kind];
  return (
    <BlockShell kind={block.kind} id={block.id} locked label={kindLabel} action={<LockGlyph />}>
      <div className="lock-panel" data-lock-panel>
        <div>
          <p className="font-label text-label uppercase">
            {interpolate(labels.lockedHeading, { kind: kindLabel })}
          </p>
          <p className="mt-2 text-[0.9375rem] opacity-70">{labels.lockedBody}</p>
        </div>
        <a href={`/${locale}/pricing`} className="text-accent font-label text-eyebrow uppercase">
          <TextSwap>{labels.lockedCta} →</TextSwap>
        </a>
      </div>
    </BlockShell>
  );
}

// ---------------------------------------------------------------------------
// asset helpers
// ---------------------------------------------------------------------------

function AssetMedia({ asset, alt, labels }: { asset: ShapedAssetRef; alt: string; labels: PlaybookLabels }) {
  const ratio = asset.w && asset.h ? { aspectRatio: `${asset.w} / ${asset.h}` } : undefined;

  if (asset.mime.startsWith('video/')) {
    return (
      <video
        src={asset.src}
        className="w-full border border-hairline"
        style={ratio}
        controls
        muted
        playsInline
        preload="metadata"
      />
    );
  }
  if (asset.mime.startsWith('image/')) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- entitlement-gated URL, no loader
      <img
        src={asset.src}
        alt={alt}
        {...(asset.w ? { width: asset.w } : {})}
        {...(asset.h ? { height: asset.h } : {})}
        loading="lazy"
        decoding="async"
        className="w-full border border-hairline object-cover"
      />
    );
  }
  return (
    <p className="border border-dashed border-hairline p-6 font-mono text-code opacity-60">
      {labels.assetMissing}
    </p>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// the six
// ---------------------------------------------------------------------------

function PromptBody({ content, labels }: { content: Extract<ShapedBlockContent, { kind: 'prompt' }>; labels: PlaybookLabels }) {
  return (
    <div className="space-y-4">
      <pre className="overflow-x-auto font-mono text-code leading-relaxed whitespace-pre-wrap">
        {content.text}
      </pre>
      {(content.model || content.negative) && (
        <dl className="grid gap-2 border-t border-hairline pt-4 font-mono text-code sm:grid-cols-[auto_1fr] sm:gap-x-6">
          {content.model && (
            <>
              <dt className="opacity-60">{labels.promptModel}</dt>
              <dd>{content.model}</dd>
            </>
          )}
          {content.negative && (
            <>
              <dt className="opacity-60">{labels.promptNegative}</dt>
              <dd className="whitespace-pre-wrap">{content.negative}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}

function ParamsBody({ content, labels }: { content: Extract<ShapedBlockContent, { kind: 'params' }>; labels: PlaybookLabels }) {
  return (
    <table className="w-full border-collapse font-mono text-code">
      <thead>
        <tr className="border-b border-hairline text-left">
          <th scope="col" className="pb-2 font-normal opacity-60">
            {labels.paramKey}
          </th>
          <th scope="col" className="pb-2 font-normal opacity-60">
            {labels.paramValue}
          </th>
        </tr>
      </thead>
      <tbody>
        {content.rows.map((row, index) => (
          <tr key={`${row.k}-${index}`} className="border-b border-hairline last:border-b-0">
            <th scope="row" className="py-2 pr-6 text-left font-normal opacity-70">
              {row.k}
            </th>
            <td className="py-2 break-words">{row.v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

export function BlockView({
  block,
  locale,
  labels,
  canCopy = false,
}: {
  block: ShapedBlock;
  locale: string;
  labels: PlaybookLabels;
  /**
   * §3.3 + the pricing table: "One-click copy on prompts and params" is a PRO feature. The bytes
   * are already on the page for anyone who can see the block, so this is a product promise rather
   * than a gate — which is exactly why it is a presentation prop and not a second authorization.
   */
  canCopy?: boolean;
}) {
  if (block.locked) return <LockedBlock block={block} locale={locale} labels={labels} />;

  const label = labels.kinds[block.kind];
  const content = block.content;
  const copyLabels = { copy: labels.copy, copied: labels.copied, failed: labels.copyFailed };

  switch (content.kind) {
    case 'prompt':
      return (
        <BlockShell
          kind="prompt"
          id={block.id}
          locked={false}
          label={label}
          action={canCopy ? <CopyButton value={content.text} labels={copyLabels} /> : undefined}
        >
          <PromptBody content={content} labels={labels} />
        </BlockShell>
      );

    case 'params':
      return (
        <BlockShell
          kind="params"
          id={block.id}
          locked={false}
          label={label}
          action={
            canCopy ? (
              <CopyButton
                value={content.rows.map((row) => `${row.k}\t${row.v}`).join('\n')}
                labels={copyLabels}
              />
            ) : undefined
          }
        >
          <ParamsBody content={content} labels={labels} />
        </BlockShell>
      );

    case 'asset': {
      const caption = content.caption ? localize(content.caption, locale) : '';
      return (
        <BlockShell kind="asset" id={block.id} locked={false} label={label}>
          <figure className="space-y-3">
            <AssetMedia asset={content.asset} alt={caption} labels={labels} />
            {caption && <figcaption className="text-[0.9375rem] opacity-70">{caption}</figcaption>}
          </figure>
        </BlockShell>
      );
    }

    case 'note':
      return (
        <BlockShell kind="note" id={block.id} locked={false} label={label}>
          <Markdown source={localize(content.md, locale)} />
        </BlockShell>
      );

    case 'link':
      return (
        <BlockShell kind="link" id={block.id} locked={false} label={label}>
          <a
            href={content.url}
            rel="noreferrer"
            className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1"
          >
            <span className="text-accent text-body">
              <TextSwap>{localize(content.label, locale)} ↗</TextSwap>
            </span>
            <span className="font-mono text-code opacity-60">{hostOf(content.url)}</span>
          </a>
        </BlockShell>
      );

    case 'workflow_file':
      return (
        <BlockShell kind="workflow_file" id={block.id} locked={false} label={label}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-mono text-code">{content.filename}</p>
              <p className="mt-1 font-mono text-code opacity-60">
                {content.format.toUpperCase()} · {formatBytes(content.size_bytes)}
              </p>
            </div>
            <a
              href={content.asset.src}
              download={content.filename}
              className="border border-current px-4 py-2 font-label text-eyebrow uppercase"
            >
              <TextSwap>{labels.download} ↓</TextSwap>
            </a>
          </div>
        </BlockShell>
      );
  }
}
