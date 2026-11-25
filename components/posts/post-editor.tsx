'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import type { Dictionary } from '@/messages/en';
import type { Locale } from '@/lib/i18n/config';
import { interpolate } from '@/lib/i18n/format';
import type { MakerWork } from '@/lib/makers/works';
import { makerWorkSrc } from '@/lib/makers/links';
import type { PromptCard } from '@/lib/prompts/catalog';
import { PromptCardView } from '@/components/prompts/prompt-card';
import { cardRatio } from '@/components/prompts/card-frame';
import type { PromptLabels } from '@/components/prompts/labels';
import { ClipCard } from '@/components/recipes/clip-card';
import { BUTTON, BUTTON_OUTLINE, FIELD, HINT, PANEL } from '@/components/creators/styles';
import { makerBlogPostHref, postEditorHref } from '@/lib/posts/links';
import {
  buildImportedTemplateBlocks,
  createEmptyBlock,
  duplicateBlock,
  moveBlock,
  removeBlock,
  sanitizeDraftBlocks,
} from '@/lib/posts/editor-helpers';
import {
  POST_BLOCK_TYPES,
  POST_HEADING_MAX,
  POST_LIST_MAX_ITEMS,
  POST_MAX_BLOCKS,
  POST_MEDIA_CAPTION_MAX,
  POST_PROMPT_MAX,
  POST_PROMPT_META_MAX,
  POST_PROMPT_NOTE_MAX,
  POST_PROMPT_TITLE_MAX,
  POST_SUMMARY_MAX,
  POST_TEXT_MAX,
  POST_TITLE_MAX,
  POST_TITLE_MIN,
  parseInstagramPost,
  type PostBlock,
  type PostBlockType,
  type PostStatus,
} from '@/lib/posts/schema';
import type { MakerImportableTemplate, MakerPost } from '@/lib/posts/service';
import { InstagramEmbed } from './instagram-embed';

type ErrorMap = Dictionary['makerBlog']['errors'];

export interface PublishableTemplateOption {
  slug: string;
  title: string;
  card: PromptCard;
}

function errorMessage(errors: ErrorMap, code: string | undefined): string {
  if (code && Object.prototype.hasOwnProperty.call(errors, code)) {
    return errors[code as keyof ErrorMap];
  }
  return errors.unavailable;
}

function workLabel(work: MakerWork): string {
  return work.title?.trim() || work.caption?.trim() || `${work.kind} · ${work.id}`;
}

function blockPreviewSummary(
  block: PostBlock,
  worksById: ReadonlyMap<string, MakerWork>,
  templatesBySlug: ReadonlyMap<string, PublishableTemplateOption>,
): string {
  switch (block.type) {
    case 'heading':
    case 'text':
      return block.text.trim().slice(0, 48);
    case 'list':
      return block.items.map((item) => item.trim()).filter(Boolean).slice(0, 2).join(', ').slice(0, 48);
    case 'media': {
      const work = worksById.get(block.workId);
      return work ? workLabel(work).slice(0, 48) : block.workId;
    }
    case 'prompt':
      return block.title.trim().slice(0, 48);
    case 'template':
      return templatesBySlug.get(block.slug)?.title.slice(0, 48) ?? block.slug;
    case 'instagram':
      return block.url.trim().slice(0, 48);
  }
}

export function PostEditor({
  locale,
  handle,
  initialPost,
  works,
  importableTemplates,
  publishedTemplates,
  promptLabels,
  blogCopy,
  recipeCopy,
  backHref,
}: {
  locale: Locale;
  handle: string | null;
  initialPost: MakerPost | null;
  works: readonly MakerWork[];
  importableTemplates: readonly MakerImportableTemplate[];
  publishedTemplates: readonly PublishableTemplateOption[];
  promptLabels: PromptLabels;
  blogCopy: Dictionary['makerBlog'];
  recipeCopy: Dictionary['makerRecipe'];
  backHref: string;
}) {
  const router = useRouter();

  const [postId, setPostId] = useState<string | null>(initialPost?.id ?? null);
  const [slug, setSlug] = useState<string | null>(initialPost?.slug ?? null);
  const [status, setStatus] = useState<PostStatus>(initialPost?.status ?? 'draft');
  const [hiddenReason] = useState<string | null>(initialPost?.hiddenReason ?? null);
  const [title, setTitle] = useState<string>(initialPost?.title ?? '');
  const [summary, setSummary] = useState<string>(initialPost?.summary ?? '');
  const [coverWorkId, setCoverWorkId] = useState<string>(initialPost?.coverWorkId ?? '');
  const [blocks, setBlocks] = useState<PostBlock[]>(() => initialPost?.blocks ?? []);
  const [selectedIndex, setSelectedIndex] = useState<number>(() => (initialPost?.blocks.length ? 0 : -1));
  const [importSlug, setImportSlug] = useState<string>(importableTemplates[0]?.slug ?? '');
  const [rightsConfirmed, setRightsConfirmed] = useState<boolean>(initialPost?.status === 'published');
  const [previewMode, setPreviewMode] = useState<boolean>(false);
  const [busy, setBusy] = useState<'save' | 'publish' | 'unpublish' | 'delete' | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null);

  const worksById = useMemo(() => new Map(works.map((work) => [work.id, work])), [works]);
  const templatesBySlug = useMemo(
    () => new Map(publishedTemplates.map((item) => [item.slug, item])),
    [publishedTemplates],
  );

  const locked = status === 'hidden';
  const selectedBlock = selectedIndex >= 0 && selectedIndex < blocks.length ? blocks[selectedIndex]! : null;
  const statusLabel =
    status === 'published'
      ? blogCopy.statusPublished
      : status === 'hidden'
        ? blogCopy.statusHidden
        : blogCopy.statusDraft;

  const clipLabels = {
    tipHeading: recipeCopy.how.tipHeading,
    expand: recipeCopy.how.expand,
    collapse: recipeCopy.how.collapse,
    copy: recipeCopy.how.copy,
    copied: recipeCopy.how.copied,
  };

  const instagramLabels = {
    placeholderLabel: blogCopy.instagramPlaceholderLabel,
    showEmbed: blogCopy.instagramShowEmbed,
    openExternal: blogCopy.instagramOpenExternal,
    fallback: blogCopy.instagramFallback,
  };

  function updateBlock(index: number, nextBlock: PostBlock) {
    setBlocks((prev) => prev.map((item, idx) => (idx === index ? nextBlock : item)));
  }

  function handleAddBlock(type: PostBlockType) {
    if (locked || blocks.length >= POST_MAX_BLOCKS) return;
    const empty = createEmptyBlock(type, {
      defaultWorkId: works[0]?.id ?? '',
      defaultTemplateSlug: publishedTemplates[0]?.slug ?? '',
    });
    const nextIndex = blocks.length;
    setBlocks((prev) => [...prev, empty]);
    setSelectedIndex(nextIndex);
    setFeedback(null);
  }

  function handleMove(delta: -1 | 1) {
    if (locked || selectedIndex < 0) return;
    const result = moveBlock(blocks, selectedIndex, delta);
    setBlocks(result.blocks);
    setSelectedIndex(result.nextIndex);
  }

  function handleDuplicate() {
    if (locked || selectedIndex < 0 || blocks.length >= POST_MAX_BLOCKS) return;
    const result = duplicateBlock(blocks, selectedIndex);
    setBlocks(result.blocks);
    setSelectedIndex(result.nextIndex);
  }

  function handleRemove() {
    if (locked || selectedIndex < 0) return;
    const result = removeBlock(blocks, selectedIndex);
    setBlocks(result.blocks);
    setSelectedIndex(result.nextIndex);
  }

  function handleImportFromTemplate() {
    if (locked || blocks.length >= POST_MAX_BLOCKS) return;
    const selected = importableTemplates.find((item) => item.slug === importSlug);
    if (!selected) return;
    const remaining = POST_MAX_BLOCKS - blocks.length;
    const imported = buildImportedTemplateBlocks(selected, remaining);
    if (imported.length === 0) return;
    const insertAt = blocks.length;
    setBlocks((prev) => [...prev, ...imported]);
    setSelectedIndex(insertAt);
    setFeedback(null);
  }

  async function postJson<T extends { ok?: boolean; code?: string; post?: MakerPost }>(
    payload: Record<string, unknown>,
  ): Promise<{ ok: true; body: T } | { ok: false; code: string }> {
    try {
      const response = await fetch('/api/makers/posts', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => ({}))) as T;
      if (!response.ok || !data.ok) {
        return { ok: false, code: data.code ?? 'unavailable' };
      }
      return { ok: true, body: data };
    } catch {
      return { ok: false, code: 'unavailable' };
    }
  }

  function syncSavedPost(saved: MakerPost) {
    const wasNew = !postId;
    setPostId(saved.id);
    setSlug(saved.slug);
    setStatus(saved.status);
    setTitle(saved.title);
    setSummary(saved.summary ?? '');
    setCoverWorkId(saved.coverWorkId ?? '');
    setBlocks(saved.blocks);
    setSelectedIndex((prev) => {
      if (saved.blocks.length === 0) return -1;
      return prev >= 0 && prev < saved.blocks.length ? prev : 0;
    });
    if (wasNew && typeof window !== 'undefined') {
      window.history.replaceState(null, '', postEditorHref(saved.id));
    }
  }

  function buildSavePayload(targetId: string | null) {
    return {
      action: 'save',
      ...(targetId ? { id: targetId } : {}),
      title: title.trim(),
      summary: summary.trim() || null,
      coverWorkId: coverWorkId || null,
      blocks: sanitizeDraftBlocks(blocks),
    };
  }

  async function handleSave() {
    if (locked || busy) return;
    setBusy('save');
    setFeedback(null);
    const res = await postJson<{ ok: true; post: MakerPost; created: boolean }>(buildSavePayload(postId));
    setBusy(null);
    if (!res.ok) {
      setFeedback({ tone: 'error', message: errorMessage(blogCopy.errors, res.code) });
      return;
    }
    syncSavedPost(res.body.post);
    setFeedback({ tone: 'ok', message: blogCopy.savedNotice });
    router.refresh();
  }

  async function handlePublish() {
    if (locked || busy) return;
    if (!rightsConfirmed) {
      setFeedback({ tone: 'error', message: blogCopy.errors.rights_required });
      return;
    }
    setBusy('publish');
    setFeedback(null);

    const savedRes = await postJson<{ ok: true; post: MakerPost; created: boolean }>(buildSavePayload(postId));
    if (!savedRes.ok) {
      setBusy(null);
      setFeedback({ tone: 'error', message: errorMessage(blogCopy.errors, savedRes.code) });
      return;
    }
    const saved = savedRes.body.post;
    syncSavedPost(saved);

    const pubRes = await postJson<{ ok: true; post: MakerPost }>({
      action: 'publish',
      id: saved.id,
      rightsConfirmed: true,
    });
    setBusy(null);
    if (!pubRes.ok) {
      setFeedback({ tone: 'error', message: errorMessage(blogCopy.errors, pubRes.code) });
      return;
    }
    syncSavedPost(pubRes.body.post);
    setFeedback({ tone: 'ok', message: blogCopy.publishedNotice });
    router.refresh();
  }

  async function handleUnpublish() {
    if (locked || busy || !postId) return;
    setBusy('unpublish');
    setFeedback(null);
    const res = await postJson<{ ok: true; post: MakerPost }>({
      action: 'unpublish',
      id: postId,
    });
    setBusy(null);
    if (!res.ok) {
      setFeedback({ tone: 'error', message: errorMessage(blogCopy.errors, res.code) });
      return;
    }
    syncSavedPost(res.body.post);
    setFeedback({ tone: 'ok', message: blogCopy.unpublishedNotice });
    router.refresh();
  }

  async function handleDelete() {
    if (locked || busy || !postId || status !== 'draft') return;
    setBusy('delete');
    setFeedback(null);
    const res = await postJson<{ ok: true }>({
      action: 'delete',
      id: postId,
    });
    setBusy(null);
    if (!res.ok) {
      setFeedback({ tone: 'error', message: errorMessage(blogCopy.errors, res.code) });
      return;
    }
    router.push(backHref);
    router.refresh();
  }

  const publicUrl = status === 'published' && handle && slug ? makerBlogPostHref(locale, handle, slug) : null;
  const coverWork = coverWorkId ? worksById.get(coverWorkId) ?? null : null;
  let previewHeadingN = 0;
  let previewPromptN = 0;

  return (
    <div data-post-editor className="space-y-6 pb-20">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-hairline pb-6">
        <div className="space-y-2">
          <a
            href={backHref}
            className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-[#52525B] transition-colors hover:text-[#09090B]"
          >
            <span aria-hidden="true">←</span>
            <span>{blogCopy.editorBack}</span>
          </a>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-2xl font-bold tracking-[-0.025em] break-keep text-[#09090B] sm:text-3xl">
              {postId ? blogCopy.editorEditTitle : blogCopy.editorNewTitle}
            </h1>
            <span
              data-post-status={status}
              className={`inline-flex min-h-7 items-center rounded-full px-3 text-xs font-semibold ${
                status === 'published'
                  ? 'bg-[#09090B] text-white'
                  : status === 'hidden'
                    ? 'bg-[#F4F4F5] text-[#CC1573]'
                    : 'bg-[#F4F4F5] text-[#52525B]'
              }`}
            >
              {statusLabel}
            </span>
          </div>
          <p className="max-w-detail break-keep text-sm leading-relaxed text-[#52525B]">
            {blogCopy.editorLede}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {publicUrl ? (
            <a
              href={publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-post-view-live
              className={BUTTON_OUTLINE}
            >
              {blogCopy.workspaceViewLive} ↗
            </a>
          ) : null}
          <button
            type="button"
            data-post-preview-toggle
            onClick={() => setPreviewMode((prev) => !prev)}
            className={BUTTON_OUTLINE}
          >
            {previewMode ? blogCopy.editorBackToEdit : blogCopy.editorViewAll}
          </button>
        </div>
      </div>

      {locked ? (
        <div
          role="alert"
          data-post-hidden-notice
          className="rounded-2xl border border-[#CC1573]/30 bg-[#FFF5FA] p-5 text-sm text-[#09090B]"
        >
          <p className="font-semibold break-keep">{blogCopy.hiddenNotice}</p>
          {hiddenReason ? (
            <p className="mt-1.5 break-keep text-[#52525B]">{hiddenReason}</p>
          ) : null}
        </div>
      ) : null}

      {previewMode ? (
        <article
          data-post-preview
          className="mx-auto max-w-detail space-y-6 rounded-2xl border border-hairline bg-white p-6 sm:p-10"
        >
          <header className="space-y-3">
            <h2 className="font-display text-2xl font-bold leading-[1.2] tracking-[-0.025em] break-keep text-[#09090B] sm:text-3xl">
              {title.trim() || blogCopy.editorNewTitle}
            </h2>
            {summary.trim() ? (
              <p className="break-keep text-base leading-[1.6] text-[#52525B]">{summary.trim()}</p>
            ) : null}
          </header>

          {coverWork ? (
            <figure className="overflow-hidden rounded-[16px] bg-[#F4F4F5]">
              {coverWork.kind === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element -- creative work gateway preview
                <img
                  src={makerWorkSrc(coverWork.id, coverWork.mime)}
                  alt={title.trim()}
                  className="max-h-[34rem] w-full object-contain"
                />
              ) : (
                <video
                  src={`${makerWorkSrc(coverWork.id, coverWork.mime)}#t=0.1`}
                  controls
                  preload="metadata"
                  playsInline
                  className="max-h-[34rem] w-full bg-[#09090B]"
                />
              )}
            </figure>
          ) : null}

          <div className="space-y-5">
            {blocks.map((block, index) => {
              switch (block.type) {
                case 'heading': {
                  previewHeadingN += 1;
                  return (
                    <h3
                      key={index}
                      className="pt-3 font-display text-xl font-semibold leading-[1.25] tracking-[-0.02em] break-keep text-[#09090B]"
                    >
                      {block.text || `${previewHeadingN}. ${blogCopy.blockTypes.heading}`}
                    </h3>
                  );
                }
                case 'text':
                  return (
                    <p
                      key={index}
                      className="whitespace-pre-line break-keep text-[15px] leading-[1.65] text-[#52525B]"
                    >
                      {block.text}
                    </p>
                  );
                case 'list':
                  return (
                    <ul key={index} className="list-disc space-y-1.5 pl-5 text-[15px] leading-[1.6] text-[#52525B]">
                      {block.items
                        .map((item) => item.trim())
                        .filter(Boolean)
                        .map((item, itemIdx) => (
                          <li key={itemIdx} className="break-keep">
                            {item}
                          </li>
                        ))}
                    </ul>
                  );
                case 'media': {
                  const media = worksById.get(block.workId);
                  if (!media) return null;
                  const src = makerWorkSrc(media.id, media.mime);
                  return (
                    <figure key={index} className="overflow-hidden rounded-[16px] bg-[#F4F4F5]">
                      {media.kind === 'image' ? (
                        // eslint-disable-next-line @next/next/no-img-element -- creative work gateway preview
                        <img src={src} alt={block.caption ?? ''} className="max-h-[34rem] w-full object-contain" />
                      ) : (
                        <video
                          src={`${src}#t=0.1`}
                          controls
                          preload="metadata"
                          playsInline
                          className="max-h-[34rem] w-full bg-[#09090B]"
                        />
                      )}
                      {block.caption?.trim() ? (
                        <figcaption className="border-t border-[#09090B]/[0.08] bg-white px-4 py-2.5 text-xs text-[#52525B]">
                          {block.caption}
                        </figcaption>
                      ) : null}
                    </figure>
                  );
                }
                case 'prompt': {
                  previewPromptN += 1;
                  return (
                    <ClipCard
                      key={index}
                      as="article"
                      number={previewPromptN}
                      title={block.title || blogCopy.blockTypes.prompt}
                      meta={block.meta?.trim() || null}
                      note={block.note?.trim() || null}
                      noteMarker="guide"
                      prompt={block.prompt}
                      labels={clipLabels}
                    />
                  );
                }
                case 'template': {
                  const option = templatesBySlug.get(block.slug);
                  if (!option) return null;
                  return (
                    <div
                      key={index}
                      className="max-w-xs"
                      style={{ '--r': cardRatio(option.card) } as CSSProperties}
                    >
                      <PromptCardView card={option.card} locale={locale} labels={promptLabels} />
                    </div>
                  );
                }
                case 'instagram':
                  return parseInstagramPost(block.url) ? (
                    <InstagramEmbed key={index} url={block.url} labels={instagramLabels} />
                  ) : null;
              }
            })}
          </div>
        </article>
      ) : (
        <>
          <section className={PANEL}>
            <div className="grid gap-5 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <div className="space-y-4">
                <div>
                  <label htmlFor="post-title" className="block text-sm font-semibold text-[#09090B]">
                    {blogCopy.editorTitleLabel}
                  </label>
                  <input
                    id="post-title"
                    data-post-title-input
                    type="text"
                    disabled={locked}
                    value={title}
                    minLength={POST_TITLE_MIN}
                    maxLength={POST_TITLE_MAX}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder={blogCopy.editorTitlePlaceholder}
                    className={FIELD}
                  />
                </div>

                <div>
                  <label htmlFor="post-summary" className="block text-sm font-semibold text-[#09090B]">
                    {blogCopy.editorSummaryLabel}
                  </label>
                  <textarea
                    id="post-summary"
                    data-post-summary-input
                    rows={2}
                    disabled={locked}
                    value={summary}
                    maxLength={POST_SUMMARY_MAX}
                    onChange={(event) => setSummary(event.target.value)}
                    placeholder={blogCopy.editorSummaryPlaceholder}
                    className={FIELD}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="post-cover" className="block text-sm font-semibold text-[#09090B]">
                  {blogCopy.editorCoverLabel}
                </label>
                <select
                  id="post-cover"
                  data-post-cover-select
                  disabled={locked}
                  value={coverWorkId}
                  onChange={(event) => setCoverWorkId(event.target.value)}
                  className={FIELD}
                >
                  <option value="">{blogCopy.editorCoverNone}</option>
                  {works.map((work) => (
                    <option key={work.id} value={work.id}>
                      {workLabel(work)}
                    </option>
                  ))}
                </select>
                {coverWork ? (
                  <div className="mt-3 overflow-hidden rounded-xl border border-hairline bg-[#F4F4F5]">
                    {coverWork.kind === 'image' ? (
                      // eslint-disable-next-line @next/next/no-img-element -- creative work gateway preview
                      <img
                        src={makerWorkSrc(coverWork.id, coverWork.mime)}
                        alt=""
                        className="h-28 w-full object-cover"
                      />
                    ) : (
                      <video
                        src={`${makerWorkSrc(coverWork.id, coverWork.mime)}#t=0.1`}
                        muted
                        playsInline
                        preload="metadata"
                        className="h-28 w-full object-cover"
                      />
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <section className={PANEL} data-post-import-panel>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-[#09090B]">{blogCopy.editorImportHeading}</h2>
                <p className="text-xs leading-relaxed break-keep text-[#52525B]">
                  {importableTemplates.length > 0 ? blogCopy.editorImportHint : blogCopy.editorImportEmpty}
                </p>
              </div>
              {importableTemplates.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label={blogCopy.editorImportHeading}
                    data-post-import-select
                    disabled={locked || blocks.length >= POST_MAX_BLOCKS}
                    value={importSlug}
                    onChange={(event) => setImportSlug(event.target.value)}
                    className="min-h-11 rounded-xl border border-hairline bg-white px-3 text-sm text-[#09090B]"
                  >
                    {importableTemplates.map((item) => (
                      <option key={item.slug} value={item.slug}>
                        {locale === 'ko' ? item.titleKo ?? item.title : item.title}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    data-post-import-btn
                    disabled={locked || blocks.length >= POST_MAX_BLOCKS}
                    onClick={handleImportFromTemplate}
                    className={BUTTON_OUTLINE}
                  >
                    {blogCopy.editorImportCta}
                  </button>
                </div>
              ) : null}
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start">
            <aside className={`${PANEL} lg:sticky lg:top-6`}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-[#09090B]">{blogCopy.editorBlocksHeading}</h2>
                <span className="text-xs font-medium tabular-nums text-[#71717A]">
                  {interpolate(blogCopy.editorBlocksCount, { n: blocks.length, max: POST_MAX_BLOCKS })}
                </span>
              </div>

              {blocks.length === 0 ? (
                <p className="rounded-xl bg-[#F4F4F5] p-4 text-xs leading-relaxed break-keep text-[#52525B]">
                  {blogCopy.editorBlocksEmpty}
                </p>
              ) : (
                <ul data-post-block-list className="space-y-2">
                  {blocks.map((block, index) => {
                    const active = index === selectedIndex;
                    const summaryText = blockPreviewSummary(block, worksById, templatesBySlug);
                    return (
                      <li key={index}>
                        <button
                          type="button"
                          data-post-block-item={index}
                          onClick={() => setSelectedIndex(index)}
                          className={`flex w-full min-h-11 flex-col items-start rounded-xl border px-3 py-2.5 text-left transition-colors ${
                            active
                              ? 'border-[#09090B] bg-[#F4F4F5]'
                              : 'border-hairline bg-white hover:bg-[#F4F4F5]/60'
                          }`}
                        >
                          <span className="flex w-full items-center justify-between gap-2 text-xs font-semibold text-[#09090B]">
                            <span>{blogCopy.blockTypes[block.type]}</span>
                            <span className="tabular-nums text-[#71717A]">#{index + 1}</span>
                          </span>
                          {summaryText ? (
                            <span className="mt-1 line-clamp-1 w-full text-xs text-[#52525B]">
                              {summaryText}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="border-t border-hairline pt-4">
                <p className="text-xs font-semibold text-[#09090B]">{blogCopy.editorAddHeading}</p>
                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  {POST_BLOCK_TYPES.map((type) => (
                    <button
                      key={type}
                      type="button"
                      data-post-add-block={type}
                      disabled={locked || blocks.length >= POST_MAX_BLOCKS}
                      onClick={() => handleAddBlock(type)}
                      className="inline-flex min-h-10 items-center justify-center rounded-xl border border-hairline bg-white px-2.5 text-xs font-medium text-[#09090B] transition-colors hover:bg-[#F4F4F5] disabled:opacity-40"
                    >
                      + {blogCopy.blockTypes[type]}
                    </button>
                  ))}
                </div>
              </div>
            </aside>

            <section className={PANEL} data-post-block-editor>
              {!selectedBlock ? (
                <p className="py-12 text-center text-sm break-keep text-[#71717A]">
                  {blogCopy.editorBlocksEmpty}
                </p>
              ) : (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline pb-4">
                    <span className="text-sm font-semibold text-[#09090B]">
                      #{selectedIndex + 1} · {blogCopy.blockTypes[selectedBlock.type]}
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        data-block-move-up
                        disabled={locked || selectedIndex <= 0}
                        onClick={() => handleMove(-1)}
                        className="inline-flex min-h-9 items-center rounded-lg border border-hairline px-3 text-xs font-medium disabled:opacity-35"
                      >
                        {blogCopy.editorMoveUp}
                      </button>
                      <button
                        type="button"
                        data-block-move-down
                        disabled={locked || selectedIndex >= blocks.length - 1}
                        onClick={() => handleMove(1)}
                        className="inline-flex min-h-9 items-center rounded-lg border border-hairline px-3 text-xs font-medium disabled:opacity-35"
                      >
                        {blogCopy.editorMoveDown}
                      </button>
                      <button
                        type="button"
                        data-block-duplicate
                        disabled={locked || blocks.length >= POST_MAX_BLOCKS}
                        onClick={handleDuplicate}
                        className="inline-flex min-h-9 items-center rounded-lg border border-hairline px-3 text-xs font-medium disabled:opacity-35"
                      >
                        {blogCopy.editorDuplicate}
                      </button>
                      <button
                        type="button"
                        data-block-delete
                        disabled={locked}
                        onClick={handleRemove}
                        className="inline-flex min-h-9 items-center rounded-lg border border-hairline px-3 text-xs font-medium text-[#CC1573] disabled:opacity-35"
                      >
                        {blogCopy.editorDeleteBlock}
                      </button>
                    </div>
                  </div>

                  {selectedBlock.type === 'heading' ? (
                    <div>
                      <label htmlFor="block-heading" className="block text-sm font-medium">
                        {blogCopy.fieldHeadingText}
                      </label>
                      <input
                        id="block-heading"
                        type="text"
                        disabled={locked}
                        value={selectedBlock.text}
                        maxLength={POST_HEADING_MAX}
                        onChange={(event) =>
                          updateBlock(selectedIndex, { type: 'heading', text: event.target.value })
                        }
                        className={FIELD}
                      />
                    </div>
                  ) : null}

                  {selectedBlock.type === 'text' ? (
                    <div>
                      <label htmlFor="block-text" className="block text-sm font-medium">
                        {blogCopy.fieldTextBody}
                      </label>
                      <textarea
                        id="block-text"
                        rows={7}
                        disabled={locked}
                        value={selectedBlock.text}
                        maxLength={POST_TEXT_MAX}
                        onChange={(event) =>
                          updateBlock(selectedIndex, { type: 'text', text: event.target.value })
                        }
                        className={FIELD}
                      />
                    </div>
                  ) : null}

                  {selectedBlock.type === 'list' ? (
                    <div>
                      <label htmlFor="block-list" className="block text-sm font-medium">
                        {blogCopy.fieldListItems}
                      </label>
                      <textarea
                        id="block-list"
                        rows={6}
                        disabled={locked}
                        value={selectedBlock.items.join('\n')}
                        onChange={(event) =>
                          updateBlock(selectedIndex, {
                            type: 'list',
                            items: event.target.value.split(/\r?\n/).slice(0, POST_LIST_MAX_ITEMS),
                          })
                        }
                        className={FIELD}
                      />
                    </div>
                  ) : null}

                  {selectedBlock.type === 'media' ? (
                    <div className="space-y-4">
                      <div>
                        <label htmlFor="block-media-work" className="block text-sm font-medium">
                          {blogCopy.fieldWorkSelect}
                        </label>
                        {works.length === 0 ? (
                          <p className="mt-2 text-xs text-[#71717A]">{blogCopy.fieldWorkNone}</p>
                        ) : (
                          <select
                            id="block-media-work"
                            disabled={locked}
                            value={selectedBlock.workId}
                            onChange={(event) =>
                              updateBlock(selectedIndex, {
                                ...selectedBlock,
                                workId: event.target.value,
                              })
                            }
                            className={FIELD}
                          >
                            <option value="">{blogCopy.fieldWorkSelect}</option>
                            {works.map((work) => (
                              <option key={work.id} value={work.id}>
                                {workLabel(work)}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                      <div>
                        <label htmlFor="block-media-caption" className="block text-sm font-medium">
                          {blogCopy.fieldMediaCaption}
                        </label>
                        <input
                          id="block-media-caption"
                          type="text"
                          disabled={locked}
                          value={selectedBlock.caption ?? ''}
                          maxLength={POST_MEDIA_CAPTION_MAX}
                          onChange={(event) =>
                            updateBlock(selectedIndex, {
                              ...selectedBlock,
                              caption: event.target.value,
                            })
                          }
                          className={FIELD}
                        />
                      </div>
                    </div>
                  ) : null}

                  {selectedBlock.type === 'prompt' ? (
                    <div className="space-y-4">
                      <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                        <div>
                          <label htmlFor="block-prompt-title" className="block text-sm font-medium">
                            {blogCopy.fieldPromptTitle}
                          </label>
                          <input
                            id="block-prompt-title"
                            type="text"
                            disabled={locked}
                            value={selectedBlock.title}
                            maxLength={POST_PROMPT_TITLE_MAX}
                            onChange={(event) =>
                              updateBlock(selectedIndex, {
                                ...selectedBlock,
                                title: event.target.value,
                              })
                            }
                            className={FIELD}
                          />
                        </div>
                        <div>
                          <label htmlFor="block-prompt-kind" className="block text-sm font-medium">
                            {blogCopy.fieldPromptKind}
                          </label>
                          <select
                            id="block-prompt-kind"
                            disabled={locked}
                            value={selectedBlock.kind}
                            onChange={(event) =>
                              updateBlock(selectedIndex, {
                                ...selectedBlock,
                                kind: event.target.value === 'video' ? 'video' : 'image',
                              })
                            }
                            className={FIELD}
                          >
                            <option value="image">{blogCopy.promptLockedKindImage}</option>
                            <option value="video">{blogCopy.promptLockedKindVideo}</option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <label htmlFor="block-prompt-meta" className="block text-sm font-medium">
                          {blogCopy.fieldPromptMeta}
                        </label>
                        <input
                          id="block-prompt-meta"
                          type="text"
                          disabled={locked}
                          value={selectedBlock.meta ?? ''}
                          maxLength={POST_PROMPT_META_MAX}
                          onChange={(event) =>
                            updateBlock(selectedIndex, {
                              ...selectedBlock,
                              meta: event.target.value,
                            })
                          }
                          className={FIELD}
                        />
                      </div>

                      <div>
                        <label htmlFor="block-prompt-tip" className="block text-sm font-medium">
                          {blogCopy.fieldPromptTip}
                        </label>
                        <textarea
                          id="block-prompt-tip"
                          rows={2}
                          disabled={locked}
                          value={selectedBlock.note ?? ''}
                          maxLength={POST_PROMPT_NOTE_MAX}
                          onChange={(event) =>
                            updateBlock(selectedIndex, {
                              ...selectedBlock,
                              note: event.target.value,
                            })
                          }
                          className={FIELD}
                        />
                      </div>

                      <div>
                        <label htmlFor="block-prompt-body" className="block text-sm font-medium">
                          {blogCopy.fieldPromptBody}
                        </label>
                        <textarea
                          id="block-prompt-body"
                          rows={6}
                          disabled={locked}
                          value={selectedBlock.prompt}
                          maxLength={POST_PROMPT_MAX}
                          onChange={(event) =>
                            updateBlock(selectedIndex, {
                              ...selectedBlock,
                              prompt: event.target.value,
                            })
                          }
                          className={FIELD}
                        />
                      </div>
                    </div>
                  ) : null}

                  {selectedBlock.type === 'template' ? (
                    <div>
                      <label htmlFor="block-template-slug" className="block text-sm font-medium">
                        {blogCopy.fieldTemplateSelect}
                      </label>
                      {publishedTemplates.length === 0 ? (
                        <p className="mt-2 text-xs text-[#71717A]">{blogCopy.fieldTemplateEmpty}</p>
                      ) : (
                        <select
                          id="block-template-slug"
                          disabled={locked}
                          value={selectedBlock.slug}
                          onChange={(event) =>
                            updateBlock(selectedIndex, { type: 'template', slug: event.target.value })
                          }
                          className={FIELD}
                        >
                          <option value="">{blogCopy.fieldTemplateSelect}</option>
                          {publishedTemplates.map((item) => (
                            <option key={item.slug} value={item.slug}>
                              {item.title} ({item.slug})
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  ) : null}

                  {selectedBlock.type === 'instagram' ? (
                    <div>
                      <label htmlFor="block-instagram-url" className="block text-sm font-medium">
                        {blogCopy.fieldInstagramUrl}
                      </label>
                      <input
                        id="block-instagram-url"
                        type="url"
                        disabled={locked}
                        value={selectedBlock.url}
                        onChange={(event) =>
                          updateBlock(selectedIndex, { type: 'instagram', url: event.target.value })
                        }
                        placeholder="https://www.instagram.com/reel/..."
                        className={FIELD}
                      />
                      <span className={HINT}>{blogCopy.fieldInstagramHint}</span>
                    </div>
                  ) : null}
                </div>
              )}
            </section>
          </div>
        </>
      )}

      <section className={PANEL}>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-[#09090B]">
          <input
            type="checkbox"
            data-post-rights-confirm
            disabled={locked}
            checked={rightsConfirmed}
            onChange={(event) => setRightsConfirmed(event.target.checked)}
            className="size-4 accent-[#09090B]"
          />
          <span className="break-keep">{blogCopy.rightsConfirm}</span>
        </label>

        {feedback ? (
          <p
            role="status"
            aria-live="polite"
            data-post-feedback={feedback.tone}
            className={`text-sm font-medium break-keep ${
              feedback.tone === 'error' ? 'text-[#CC1573]' : 'text-[#09090B]'
            }`}
          >
            {feedback.message}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              data-post-save
              disabled={locked || busy !== null}
              onClick={handleSave}
              className={BUTTON_OUTLINE}
            >
              {blogCopy.saveDraftCta}
            </button>
            {status !== 'published' ? (
              <button
                type="button"
                data-post-publish
                disabled={locked || busy !== null}
                onClick={handlePublish}
                className={BUTTON}
              >
                {blogCopy.publishCta}
              </button>
            ) : (
              <button
                type="button"
                data-post-unpublish
                disabled={locked || busy !== null}
                onClick={handleUnpublish}
                className={BUTTON_OUTLINE}
              >
                {blogCopy.unpublishCta}
              </button>
            )}
          </div>

          {postId && status === 'draft' ? (
            <button
              type="button"
              data-post-delete
              disabled={busy !== null}
              onClick={handleDelete}
              className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium text-[#CC1573] transition-colors hover:bg-[#F4F4F5] disabled:opacity-40"
            >
              {blogCopy.deletePostCta}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
