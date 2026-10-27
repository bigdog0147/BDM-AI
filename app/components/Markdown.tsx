"use client";

import { useState } from "react";
import { parseInline, parseMarkdown, type Block } from "../../lib/markdown";
import { Icon } from "./Icons";

export type MarkdownSource = {
  index: number;
  title: string;
  url: string;
  domain?: string;
};

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="code-block">
      <div className="code-head">
        <span className="code-lang">{language || "text"}</span>
        <button type="button" className="code-copy" onClick={() => void copy()}>
          <Icon name={copied ? "check" : "copy"} size={14} />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function Inline({
  text,
  sources
}: {
  text: string;
  sources?: MarkdownSource[];
}) {
  const known = new Set((sources ?? []).map((source) => source.index));
  const tokens = parseInline(text, known);

  return (
    <>
      {tokens.map((token, index) => {
        const key = `${token.type}-${index}`;
        switch (token.type) {
          case "strong":
            return <strong key={key}>{token.text}</strong>;
          case "em":
            return <em key={key}>{token.text}</em>;
          case "code":
            return (
              <code key={key} className="inline-code">
                {token.text}
              </code>
            );
          case "link":
            return (
              <a
                key={key}
                href={token.href}
                target="_blank"
                rel="noopener noreferrer nofollow"
              >
                {token.text}
              </a>
            );
          case "citation": {
            const source = sources?.find((item) => item.index === token.index);
            if (!source) return <span key={key}>{token.text}</span>;
            return (
              <a
                key={key}
                className="citation"
                href={source.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                title={source.title}
                aria-label={`Source ${token.index}: ${source.title}`}
              >
                {token.text}
              </a>
            );
          }
          default:
            return token.text;
        }
      })}
    </>
  );
}

function renderBlock(block: Block, sources: MarkdownSource[] | undefined, key: string) {
  switch (block.type) {
    case "heading": {
      const Tag = (`h${Math.min(4, block.level + 2)}`) as "h3" | "h4" | "h5" | "h6";
      return (
        <Tag key={key} className="md-heading">
          <Inline text={block.text} sources={sources} />
        </Tag>
      );
    }
    case "code":
      return <CodeBlock key={key} language={block.language} code={block.code} />;
    case "list":
      return block.ordered ? (
        <ol key={key} className="md-list">
          {block.items.map((item, index) => (
            <li key={`${key}-${index}`}>
              <Inline text={item} sources={sources} />
            </li>
          ))}
        </ol>
      ) : (
        <ul key={key} className="md-list">
          {block.items.map((item, index) => (
            <li key={`${key}-${index}`}>
              <Inline text={item} sources={sources} />
            </li>
          ))}
        </ul>
      );
    case "quote":
      return (
        <blockquote key={key} className="md-quote">
          <Inline text={block.text} sources={sources} />
        </blockquote>
      );
    case "rule":
      return <hr key={key} className="md-rule" />;
    default:
      return (
        <p key={key} className="md-paragraph">
          <Inline text={block.text} sources={sources} />
        </p>
      );
  }
}

/**
 * Renders assistant text as Markdown without ever using raw HTML.
 *
 * `sources` lets citation markers such as [1] become real links to the
 * sources that were actually returned by the search provider.
 */
export default function Markdown({
  content,
  sources
}: {
  content: string;
  sources?: MarkdownSource[];
}) {
  const blocks = parseMarkdown(content);

  return (
    <div className="markdown">
      {blocks.map((block, index) =>
        renderBlock(block, sources, `block-${index}`)
      )}
    </div>
  );
}
