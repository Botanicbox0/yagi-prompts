import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { promptLabels } from '@/components/prompts/labels';
import { PostAccessProvider } from '@/components/posts/post-access-context';
import { PostBlocks } from '@/components/posts/post-blocks';
import { InstagramEmbed } from '@/components/posts/instagram-embed';
import { toPublicBlocks } from '@/lib/posts/public';
import { parseInstagramPost, type PostBlock } from '@/lib/posts/schema';
import { buildSitemap } from '@/lib/seo/sitemap';

describe('blog rendering, prompt redaction, Instagram facade, and sitemap gating', () => {
  it('redacts secret prompt fields in static SSR HTML and renders plain text safely without autoplaying video', () => {
    const dict = getDictionary('ko');
    const blocks: PostBlock[] = [
      { type: 'heading', text: 'First Heading' },
      { type: 'text', text: '<script>alert("xss")</script> [link](https://evil.example)' },
      { type: 'list', items: ['Step A', 'Step B'] },
      { type: 'media', workId: 'wrk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', caption: 'Lighting test' },
      {
        type: 'prompt',
        title: 'Public Prompt Title',
        kind: 'video',
        meta: 'META_SECRET_ONLY',
        prompt: 'PROMPT_BODY_SECRET_ONLY',
        note: 'TIP_NOTE_SECRET_ONLY',
      },
      { type: 'instagram', url: 'https://instagram.com/reel/C9AbCdEf123/?igsh=secret' },
    ];

    const publicBlocks = toPublicBlocks(blocks);
    expect(publicBlocks[4]).toEqual({ type: 'prompt', title: 'Public Prompt Title', kind: 'video' });

    const html = renderToStaticMarkup(
      <PostAccessProvider accessEndpoint={null}>
        <PostBlocks
          blocks={publicBlocks}
          works={{
            wrk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: {
              id: 'wrk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              kind: 'video',
              src: '/api/makers/media/work-wrk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.mp4',
              width: 720,
              height: 1280,
            },
          }}
          templatesBySlug={new Map()}
          locale="ko"
          promptLabels={promptLabels(dict)}
          blogCopy={dict.makerBlog}
          recipeCopy={dict.makerRecipe}
          signinHref="/auth/signin?next=%2Fko%2Fmakers%2Fjun%2Fblog%2Ftest&locale=ko"
        />
      </PostAccessProvider>,
    );

    // 1. Prompt secrets never enter the SSR HTML.
    expect(html).toContain('Public Prompt Title');
    expect(html).not.toContain('META_SECRET_ONLY');
    expect(html).not.toContain('PROMPT_BODY_SECRET_ONLY');
    expect(html).not.toContain('TIP_NOTE_SECRET_ONLY');

    // 2. Text blocks never render HTML tags or markdown links.
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(html).not.toContain('href="https://evil.example"');

    // 3. Video does not autoplay and declares metadata preload + #t=0.1 frame hint.
    expect(html).not.toContain('autoplay');
    expect(html).not.toContain('autoPlay');
    expect(html).toContain('preload="metadata"');
    expect(html).toContain('#t=0.1');

    // 4. Instagram facade loads zero third-party frames/scripts/images before click and hides handle.
    expect(html).toContain('data-maker-blog-instagram="idle"');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('https://www.instagram.com/reel/C9AbCdEf123/embed');
    expect(html).toContain('href="https://www.instagram.com/reel/C9AbCdEf123/"');
    expect(html).toContain('rel="noopener noreferrer nofollow ugc"');
    expect(html).not.toContain('igsh=');
  });

  it('normalizes valid Instagram posts/reels and rejects profiles or stories', () => {
    expect(parseInstagramPost('https://www.instagram.com/p/C9AbCdEf123/?utm_source=ig')).toEqual({
      kind: 'p',
      id: 'C9AbCdEf123',
      url: 'https://www.instagram.com/p/C9AbCdEf123/',
      embedUrl: 'https://www.instagram.com/p/C9AbCdEf123/embed',
    });
    expect(parseInstagramPost('https://www.instagram.com/some_account/')).toBeNull();
    expect(parseInstagramPost('https://www.instagram.com/stories/some_account/12345/')).toBeNull();
    expect(parseInstagramPost('https://evil.example/p/C9AbCdEf123/')).toBeNull();

    const dict = getDictionary('ko');
    const html = renderToStaticMarkup(
      <InstagramEmbed
        url="https://www.instagram.com/some_account/"
        labels={{
          placeholderLabel: dict.makerBlog.instagramPlaceholderLabel,
          showEmbed: dict.makerBlog.instagramShowEmbed,
          openExternal: dict.makerBlog.instagramOpenExternal,
          fallback: dict.makerBlog.instagramFallback,
        }}
      />,
    );
    expect(html).toBe('');
  });

  it('includes /makers/{handle}/blog/{slug} in sitemap only when makerPosts are supplied', () => {
    const empty = buildSitemap({ origin: 'https://twings.app', cards: [] });
    expect(empty.some((entry) => entry.url.includes('/blog/'))).toBe(false);

    const populated = buildSitemap({
      origin: 'https://twings.app',
      cards: [],
      makerPosts: [
        { handle: 'jun', slug: 'rainy-cafe-notes', updatedAt: '2026-11-26T00:00:00.000Z' },
      ],
    });
    const ko = populated.find((entry) => entry.url === 'https://twings.app/ko/makers/jun/blog/rainy-cafe-notes');
    const en = populated.find((entry) => entry.url === 'https://twings.app/en/makers/jun/blog/rainy-cafe-notes');
    expect(ko).toBeDefined();
    expect(en).toBeDefined();
    expect(ko?.alternates?.languages?.en).toBe('https://twings.app/en/makers/jun/blog/rainy-cafe-notes');
    expect(ko?.lastModified).toEqual(new Date('2026-11-26T00:00:00.000Z'));
  });
});
