/**
 * PLAN §6.1 — `note = { md: Localized }`. This is the whole markdown surface the product has.
 *
 * Deliberately an in-repo parser rather than a dependency (M2 brief: "no new md dependency if
 * avoidable"). Two reasons beyond dependency count:
 *   · it emits a TOKEN TREE, not an HTML string, so the renderer never touches
 *     `dangerouslySetInnerHTML` and authored content can never inject markup;
 *   · the supported subset is a product decision (§3.8 "tips/warnings"), not a library's default —
 *     no images, no raw HTML, no tables. A note that needs a table should have been a `params`
 *     block, and the contract says so.
 *
 * Supported: paragraphs, `#`..`###` headings, `-`/`*`/`1.` lists, blockquotes, fenced code,
 * `**strong**`, `*em*`, `` `code` ``, `[text](href)` with an http/https/mailto allowlist.
 */

export type InlineNode =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: InlineNode[] }
  | { type: 'em'; children: InlineNode[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; children: InlineNode[] };

export type MarkdownNode =
  | { type: 'paragraph'; children: InlineNode[] }
  | { type: 'heading'; level: 1 | 2 | 3; children: InlineNode[] }
  | { type: 'list'; ordered: boolean; items: InlineNode[][] }
  | { type: 'quote'; children: InlineNode[] }
  | { type: 'code'; value: string; lang: string | null };

const SAFE_PROTOCOL = /^(https?:|mailto:)/i;

/** Anything not on the allowlist loses its href and renders as plain text. */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (href.startsWith('/') && !href.startsWith('//')) return href;
  return SAFE_PROTOCOL.test(href) ? href : null;
}

// ---------------------------------------------------------------------------
// inline
// ---------------------------------------------------------------------------

const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/;

export function parseInline(source: string): InlineNode[] {
  const out: InlineNode[] = [];
  let rest = source;

  while (rest.length > 0) {
    const match = INLINE.exec(rest);
    if (!match || match.index === undefined) {
      out.push({ type: 'text', value: rest });
      break;
    }
    if (match.index > 0) out.push({ type: 'text', value: rest.slice(0, match.index) });

    const token = match[0];
    if (token.startsWith('**')) {
      out.push({ type: 'strong', children: parseInline(token.slice(2, -2)) });
    } else if (token.startsWith('`')) {
      out.push({ type: 'code', value: token.slice(1, -1) });
    } else if (token.startsWith('[')) {
      const split = token.indexOf('](');
      const text = token.slice(1, split);
      const href = safeHref(token.slice(split + 2, -1));
      if (href) out.push({ type: 'link', href, children: parseInline(text) });
      else out.push({ type: 'text', value: text });
    } else {
      out.push({ type: 'em', children: parseInline(token.slice(1, -1)) });
    }
    rest = rest.slice(match.index + token.length);
  }

  return out.filter((node) => node.type !== 'text' || node.value.length > 0);
}

// ---------------------------------------------------------------------------
// block
// ---------------------------------------------------------------------------

const BULLET = /^\s*[-*]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^(#{1,3})\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;

export function parseMarkdown(source: string): MarkdownNode[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const nodes: MarkdownNode[] = [];

  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let quote: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    nodes.push({ type: 'paragraph', children: parseInline(paragraph.join(' ')) });
    paragraph = [];
  };
  const flushList = () => {
    if (list === null) return;
    nodes.push({
      type: 'list',
      ordered: list.ordered,
      items: list.items.map((item) => parseInline(item)),
    });
    list = null;
  };
  const flushQuote = () => {
    if (quote.length === 0) return;
    nodes.push({ type: 'quote', children: parseInline(quote.join(' ')) });
    quote = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';

    if (line.trimStart().startsWith('```')) {
      flushAll();
      const lang = line.trim().slice(3).trim();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').trimStart().startsWith('```')) {
        body.push(lines[index] ?? '');
        index += 1;
      }
      nodes.push({ type: 'code', value: body.join('\n'), lang: lang.length > 0 ? lang : null });
      continue;
    }

    if (line.trim().length === 0) {
      flushAll();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushAll();
      const level = Math.min(heading[1]!.length, 3) as 1 | 2 | 3;
      nodes.push({ type: 'heading', level, children: parseInline(heading[2]!.trim()) });
      continue;
    }

    const quoted = QUOTE.exec(line);
    if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1]!.trim());
      continue;
    }

    const bullet = BULLET.exec(line);
    const ordered = bullet ? null : ORDERED.exec(line);
    if (bullet || ordered) {
      flushParagraph();
      flushQuote();
      const isOrdered = ordered !== null;
      const text = (bullet ? bullet[1] : ordered![1])!.trim();
      if (list === null || list.ordered !== isOrdered) {
        flushList();
        list = { ordered: isOrdered, items: [] };
      }
      list.items.push(text);
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(line.trim());
  }

  flushAll();
  return nodes;
}

/** Plain-text projection — used for previews and for length-limited surfaces. */
export function markdownToText(source: string): string {
  return parseMarkdown(source)
    .map((node) => {
      if (node.type === 'code') return node.value;
      if (node.type === 'list') return node.items.map(inlineToText).join(' ');
      return inlineToText(node.children);
    })
    .join('\n')
    .trim();
}

function inlineToText(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return node.value;
        case 'code':
          return node.value;
        default:
          return inlineToText(node.children);
      }
    })
    .join('');
}
