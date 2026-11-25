import type { CSSProperties } from 'react';
import type { Dictionary } from '@/messages/en';
import type { PromptCard } from '@/lib/prompts/catalog';
import type { PublicPostBlock, PublicPostMedia } from '@/lib/posts/public';
import { headingAnchorId } from '@/lib/posts/schema';
import { PromptCardView } from '@/components/prompts/prompt-card';
import { cardRatio } from '@/components/prompts/card-frame';
import type { PromptLabels } from '@/components/prompts/labels';
import { InstagramEmbed, type InstagramEmbedLabels } from './instagram-embed';
import { PostPromptCard } from './post-prompt-card';

/**
 * Server-rendered blog blocks. Text blocks render strictly as plain text (never HTML or markdown
 * links), media blocks use `preload="metadata"` with `controls` (no autoplay), and prompt blocks
 * hand only their index + public title to `PostPromptCard`.
 */
export function PostBlocks({
  blocks,
  works,
  templatesBySlug,
  locale,
  promptLabels,
  blogCopy,
  recipeCopy,
  signinHref,
}: {
  blocks: readonly PublicPostBlock[];
  works: Readonly<Record<string, PublicPostMedia>>;
  templatesBySlug: ReadonlyMap<string, PromptCard>;
  locale: string;
  promptLabels: PromptLabels;
  blogCopy: Dictionary['makerBlog'];
  recipeCopy: Dictionary['makerRecipe'];
  signinHref: string;
}) {
  let headingNumber = 0;
  let promptIndex = 0;

  const instagramLabels: InstagramEmbedLabels = {
    placeholderLabel: blogCopy.instagramPlaceholderLabel,
    showEmbed: blogCopy.instagramShowEmbed,
    openExternal: blogCopy.instagramOpenExternal,
    fallback: blogCopy.instagramFallback,
  };

  const promptCardLabels = {
    gateTitle: blogCopy.promptGateTitle,
    gateCta: blogCopy.promptGateCta,
    card: {
      tipHeading: recipeCopy.how.tipHeading,
      expand: recipeCopy.how.expand,
      collapse: recipeCopy.how.collapse,
      copy: recipeCopy.how.copy,
      copied: recipeCopy.how.copied,
    },
  };

  return (
    <div data-maker-blog-blocks className="space-y-6">
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'heading': {
            headingNumber += 1;
            const id = headingAnchorId(headingNumber);
            return (
              <h2
                key={index}
                id={id}
                data-maker-blog-heading={headingNumber}
                className="scroll-mt-28 pt-4 font-display text-[clamp(1.35rem,2.4vw,1.875rem)] leading-[1.22] font-semibold tracking-[-0.025em] text-balance break-keep text-[#09090B] first:pt-0"
              >
                {block.text}
              </h2>
            );
          }
          case 'text':
            return (
              <p
                key={index}
                data-maker-blog-text
                className="whitespace-pre-line break-keep text-[15px] leading-[1.65] tracking-[-0.015em] text-[#52525B]"
              >
                {block.text}
              </p>
            );
          case 'list':
            return (
              <ul
                key={index}
                data-maker-blog-list
                className="list-disc space-y-2 pl-5 text-[15px] leading-[1.6] tracking-[-0.015em] text-[#52525B] marker:text-[#09090B]/40"
              >
                {block.items.map((item, itemIdx) => (
                  <li key={itemIdx} className="break-keep">
                    {item}
                  </li>
                ))}
              </ul>
            );
          case 'media': {
            const media = works[block.workId];
            if (!media) return null;
            return (
              <figure key={index} data-maker-blog-media={media.id} className="overflow-hidden rounded-[16px] bg-[#F4F4F5]">
                {media.kind === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element -- gateway-served creative work
                  <img
                    src={media.src}
                    alt={block.caption ?? ''}
                    width={media.width ?? undefined}
                    height={media.height ?? undefined}
                    loading="lazy"
                    decoding="async"
                    className="max-h-[42rem] w-full object-contain bg-[#F4F4F5]"
                  />
                ) : (
                  <video
                    src={`${media.src}#t=0.1`}
                    controls
                    preload="metadata"
                    playsInline
                    className="max-h-[42rem] w-full bg-[#09090B]"
                  />
                )}
                {block.caption ? (
                  <figcaption className="border-t border-[#09090B]/[0.08] bg-white px-4 py-2.5 text-xs leading-relaxed break-keep text-[#52525B]">
                    {block.caption}
                  </figcaption>
                ) : null}
              </figure>
            );
          }
          case 'prompt': {
            const currentPromptIndex = promptIndex;
            promptIndex += 1;
            return (
              <PostPromptCard
                key={index}
                promptIndex={currentPromptIndex}
                promptNumber={currentPromptIndex + 1}
                title={block.title}
                signinHref={signinHref}
                labels={promptCardLabels}
              />
            );
          }
          case 'template': {
            const card = templatesBySlug.get(block.slug);
            // Quietly omit unpublished or missing templates.
            if (!card) return null;
            return (
              <div
                key={index}
                data-maker-blog-template={card.slug}
                className="max-w-xs"
                style={{ '--r': cardRatio(card) } as CSSProperties}
              >
                <PromptCardView card={card} locale={locale} labels={promptLabels} />
              </div>
            );
          }
          case 'instagram':
            return <InstagramEmbed key={index} url={block.url} labels={instagramLabels} />;
        }
      })}
    </div>
  );
}
