/**
 * A small, dependency-free Markdown parser.
 *
 * It is intentionally not a full CommonMark implementation: BDM only needs
 * the subset that assistants actually emit (headings, lists, quotes, code
 * fences, inline emphasis, links and citations). Everything is produced as
 * plain data, so the renderer can turn it into React elements and never has
 * to touch `dangerouslySetInnerHTML`. Raw HTML in a model response is
 * therefore always displayed as literal text and can never execute.
 */

export type InlineToken =
  | { type: "text"; text: string }
  | { type: "strong"; text: string }
  | { type: "em"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; text: string; href: string }
  | { type: "citation"; text: string; index: number };

export type Block =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: number; text: string }
  | { type: "code"; language: string; code: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; text: string }
  | { type: "rule" };

const INLINE_PATTERN =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]\n]*\]\((?:https?:\/\/)[^\s)]+\))|(\[(\d{1,2})\])/g;

const LINK_PATTERN = /^\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)$/;

/** Only http(s) links are ever produced. */
export function isSafeHref(href: string): boolean {
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Split a line into inline tokens.
 *
 * `knownCitations` limits which `[n]` markers become citation links; a
 * marker that does not match a real source stays plain text.
 */
export function parseInline(text: string, knownCitations?: Set<number>): InlineToken[] {
  const tokens: InlineToken[] = [];
  let lastIndex = 0;

  INLINE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: "text", text: text.slice(lastIndex, match.index) });
    }

    const [whole, code, strong, strongAlt, em, emAlt, link, citation, digits] =
      match;

    if (code) {
      tokens.push({ type: "code", text: code.slice(1, -1) });
    } else if (strong) {
      tokens.push({ type: "strong", text: strong.slice(2, -2) });
    } else if (strongAlt) {
      tokens.push({ type: "strong", text: strongAlt.slice(2, -2) });
    } else if (em) {
      tokens.push({ type: "em", text: em.slice(1, -1) });
    } else if (emAlt) {
      tokens.push({ type: "em", text: emAlt.slice(1, -1) });
    } else if (link) {
      const parsed = LINK_PATTERN.exec(link);
      if (parsed && isSafeHref(parsed[2])) {
        tokens.push({ type: "link", text: parsed[1] || parsed[2], href: parsed[2] });
      } else {
        tokens.push({ type: "text", text: whole });
      }
    } else if (citation) {
      const index = Number(digits);
      if (knownCitations && knownCitations.has(index)) {
        tokens.push({ type: "citation", text: citation, index });
      } else {
        tokens.push({ type: "text", text: whole });
      }
    }

    lastIndex = match.index + whole.length;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: "text", text: text.slice(lastIndex) });
  }

  return tokens;
}

const HEADING = /^(#{1,4})\s+(.*)$/;
const UNORDERED = /^[-*]\s+(.*)$/;
const ORDERED = /^\d{1,3}[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const FENCE = /^```\s*([A-Za-z0-9_+-]*)\s*$/;

/**
 * Parse a Markdown document into blocks.
 *
 * Fenced code is captured verbatim (including its inner backticks) and never
 * interpreted as inline Markdown.
 */
export function parseMarkdown(input: string): Block[] {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line.trim());
    if (fence) {
      const language = fence[1] ?? "";
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1; // consume the closing fence (or run off the end)
      blocks.push({ type: "code", language, code: body.join("\n") });
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length,
        text: heading[2].trim()
      });
      index += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index])) {
        body.push((QUOTE.exec(lines[index]) as RegExpExecArray)[1]);
        index += 1;
      }
      blocks.push({ type: "quote", text: body.join("\n") });
      continue;
    }

    const isUnordered = UNORDERED.test(line);
    const isOrdered = ORDERED.test(line);
    if (isUnordered || isOrdered) {
      const pattern = isUnordered ? UNORDERED : ORDERED;
      const items: string[] = [];
      while (index < lines.length) {
        const item = pattern.exec(lines[index]);
        if (!item) break;
        items.push(item[1]);
        index += 1;
      }
      blocks.push({ type: "list", ordered: isOrdered, items });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index];
      if (
        !current.trim() ||
        FENCE.test(current.trim()) ||
        HEADING.test(current) ||
        QUOTE.test(current) ||
        UNORDERED.test(current) ||
        ORDERED.test(current)
      ) {
        break;
      }
      paragraph.push(current.trim());
      index += 1;
    }
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", text: paragraph.join(" ") });
    }
  }

  return blocks;
}
