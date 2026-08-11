import { Fragment, type ReactNode } from 'react';
import { parseMarkdown, type InlineNode, type MarkdownNode } from '@/lib/content/markdown';

/**
 * §6.1 `note = { md: Localized }`, rendered from the token tree produced by lib/content/markdown.ts.
 *
 * No `dangerouslySetInnerHTML` anywhere: authored markdown becomes React elements, so a note can
 * style text and nothing else. External links get `rel="noreferrer"` and the parser has already
 * dropped any href outside the http/https/mailto allowlist.
 */

function Inline({ nodes }: { nodes: InlineNode[] }): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return <Fragment key={index}>{node.value}</Fragment>;
      case 'strong':
        return (
          <strong key={index} className="font-semibold">
            <Inline nodes={node.children} />
          </strong>
        );
      case 'em':
        return (
          <em key={index}>
            <Inline nodes={node.children} />
          </em>
        );
      case 'code':
        return (
          <code key={index} className="font-mono text-code">
            {node.value}
          </code>
        );
      case 'link':
        return (
          <a
            key={index}
            href={node.href}
            className="text-accent underline underline-offset-4"
            rel="noreferrer"
          >
            <Inline nodes={node.children} />
          </a>
        );
    }
  });
}

function Block({ node }: { node: MarkdownNode }): ReactNode {
  switch (node.type) {
    case 'paragraph':
      return (
        <p className="text-body">
          <Inline nodes={node.children} />
        </p>
      );
    case 'heading': {
      const Tag = (['h3', 'h4', 'h5'] as const)[node.level - 1] ?? 'h4';
      return (
        <Tag className="font-label text-label uppercase">
          <Inline nodes={node.children} />
        </Tag>
      );
    }
    case 'quote':
      return (
        <blockquote className="border-l-2 border-accent pl-4 text-body opacity-80">
          <Inline nodes={node.children} />
        </blockquote>
      );
    case 'code':
      return (
        <pre className="overflow-x-auto border border-hairline p-4 font-mono text-code">
          <code>{node.value}</code>
        </pre>
      );
    case 'list': {
      const Tag = node.ordered ? 'ol' : 'ul';
      return (
        <Tag
          className={
            node.ordered
              ? 'list-decimal space-y-1.5 pl-5 text-body'
              : 'list-disc space-y-1.5 pl-5 text-body'
          }
        >
          {node.items.map((item, index) => (
            <li key={index}>
              <Inline nodes={item} />
            </li>
          ))}
        </Tag>
      );
    }
  }
}

export function Markdown({ source }: { source: string }) {
  const nodes = parseMarkdown(source);
  return (
    <div className="space-y-4">
      {nodes.map((node, index) => (
        <Block key={index} node={node} />
      ))}
    </div>
  );
}
