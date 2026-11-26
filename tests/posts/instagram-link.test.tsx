import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { parseInstagramPost } from '@/lib/posts/schema';
import { InstagramLink } from '@/components/posts/instagram-link';

const TEMPLATE_PAGE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../app/(marketing)/[locale]/t/[slug]/page.tsx',
);

describe('InstagramLink', () => {
  it('renders a link-only card with canonical URL and no embed markup for a reel URL', () => {
    const dict = getDictionary('ko');
    const url = 'https://www.instagram.com/reel/C9AbCdEf123/?igsh=abc';
    const canonicalUrl = parseInstagramPost(url)!.url;

    const html = renderToStaticMarkup(
      <InstagramLink
        url={url}
        labels={{
          placeholderLabel: dict.makerBlog.instagramPlaceholderLabel,
          open: dict.makerBlog.instagramShowEmbed,
        }}
      />,
    );

    expect(html).toContain('data-instagram-link');

    const anchorMatch = html.match(/<a\b[^>]*>/);
    expect(anchorMatch).not.toBeNull();
    const anchorTag = anchorMatch![0];
    expect(anchorTag).toContain('data-instagram-external');
    expect(anchorTag).toContain(`href="${canonicalUrl}"`);
    expect(anchorTag).toContain('target="_blank"');
    expect(anchorTag).toContain('rel="noopener noreferrer nofollow ugc"');

    expect(html).toContain(dict.makerBlog.instagramShowEmbed);
    expect(html).toContain(dict.makerBlog.instagramPlaceholderLabel);

    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('data-instagram-load');
    expect(html).not.toContain('data-maker-blog-instagram');
    expect(html).not.toContain('/embed');
  });

  it('renders nothing for a profile URL', () => {
    const dict = getDictionary('ko');
    const html = renderToStaticMarkup(
      <InstagramLink
        url="https://www.instagram.com/some_account/"
        labels={{
          placeholderLabel: dict.makerBlog.instagramPlaceholderLabel,
          open: dict.makerBlog.instagramShowEmbed,
        }}
      />,
    );

    expect(html).toBe('');
  });

  it('is used on the template page instead of InstagramEmbed', () => {
    const source = readFileSync(TEMPLATE_PAGE_PATH, 'utf8');
    expect(source).toContain('InstagramLink');
    expect(source).not.toContain('InstagramEmbed');
  });
});
