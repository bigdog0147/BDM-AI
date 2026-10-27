import { describe, expect, it } from "vitest";
import {
  isSafeHref,
  parseInline,
  parseMarkdown
} from "../lib/markdown";

/**
 * Markdown rendering tests.
 *
 * The renderer turns model output into React elements, so raw HTML can never
 * execute and unsafe links can never become anchors.
 */

describe("markdown block parsing", () => {
  it("splits headings, lists, quotes and code fences", () => {
    const blocks = parseMarkdown(
      [
        "# Title",
        "",
        "A paragraph line.",
        "Second line of the paragraph.",
        "",
        "- one",
        "- two",
        "",
        "1. first",
        "2. second",
        "",
        "> quoted",
        "",
        "```ts",
        "const value = 1;",
        "```",
        "",
        "---",
        "Done."
      ].join("\n")
    );

    expect(blocks.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
      "list",
      "list",
      "quote",
      "code",
      "rule",
      "paragraph"
    ]);

    const code = blocks.find((block) => block.type === "code");
    expect(code).toMatchObject({ language: "ts", code: "const value = 1;" });

    const ordered = blocks.find(
      (block) => block.type === "list" && block.ordered
    );
    expect(ordered).toMatchObject({ items: ["first", "second"] });
  });

  it("keeps code fence content verbatim", () => {
    const blocks = parseMarkdown("```\n**not bold**\n# not a heading\n```");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "code",
      code: "**not bold**\n# not a heading"
    });
  });
});

describe("inline parsing", () => {
  it("marks up emphasis, code and safe links", () => {
    const tokens = parseInline(
      "**bold** *italic* `code` [docs](https://example.com/page)"
    );

    expect(tokens.map((token) => token.type)).toEqual([
      "strong",
      "text",
      "em",
      "text",
      "code",
      "text",
      "link"
    ]);

    const link = tokens.find((token) => token.type === "link");
    expect(link).toMatchObject({ href: "https://example.com/page" });
  });

  it("never treats a dangerous URL as a link", () => {
    const tokens = parseInline(
      "[click](javascript:alert(1)) [also](data:text/html;base64,PHNjcmlwdD4=)"
    );
    expect(tokens.every((token) => token.type !== "link")).toBe(true);
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
    expect(isSafeHref("data:text/html;base64,PHNjcmlwdD4=")).toBe(false);
    expect(isSafeHref("https://example.com")).toBe(true);
  });

  it("only links citations that point at a real source", () => {
    const known = new Set([2]);
    const tokens = parseInline("Claim [2] and invented [7].", known);

    const citation = tokens.find((token) => token.type === "citation");
    expect(citation).toMatchObject({ type: "citation", index: 2, text: "[2]" });

    // [7] has no matching source, so it stays plain text.
    expect(
      tokens.some((token) => token.type === "text" && token.text === "[7]")
    ).toBe(true);
  });

  it("keeps raw HTML as literal text", () => {
    const tokens = parseInline('<script>alert("x")</script>');
    expect(tokens.every((token) => token.type === "text")).toBe(true);
  });
});
